/**
 * app.js - Optimized for Dance Tracker PWA 2026
 */

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby5wet3I48Q1zmUxWo5eHFAycw6wbwGYggHuk3_2IRMaBM1q2ePr78ayQxdVCwjM7p1/exec";
const urlParams = new URLSearchParams(window.location.search);
const idFromURL = urlParams.get('id');
let fullHistoryData = [];

window.onload = async () => {
    const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

    if (savedUser && savedUser.chipID) {
        // --- LOGGED IN ---
        showView('dancer-view');
        loadDancerView();

        if (idFromURL && idFromURL !== savedUser.chipID) {
            handleAutoLog(savedUser.chipID, idFromURL);
        }
    } else if (idFromURL) {
        // --- NEW CHIP DETECTED ---
        checkUserInSystem(idFromURL);
    } else {
        // --- PROMPT SCAN ---
        showView('scan-view');
        document.getElementById('scan-status').innerText = "Please tap your NFC chip to begin.";
    }
    validateFormState();
};

/** --- MASTER UI CONTROLLER (OVERLAYS) --- **/

function showStatus(type, title, msg, isModal = false) {
    const overlay = document.getElementById('master-overlay');
    const actions = document.getElementById('overlay-actions');
    const icons = {
        success: document.getElementById('icon-success'),
        error: document.getElementById('icon-error'),
        loading: document.getElementById('icon-loading')
    };

    // Hide all icons first
    Object.values(icons).forEach(el => el.classList.add('hidden'));

    // Show relevant icon
    if (icons[type]) icons[type].classList.remove('hidden');

    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-msg').innerText = msg;

    actions.classList.add('hidden'); // Default hidden
    overlay.classList.remove('hidden');

    // Auto-hide if not modal and not loading
    if (!isModal && type !== 'loading') {
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 2000);
    }
}

function confirmAction(title, msg, confirmText = "Confirm", cancelText = "Cancel") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('master-overlay');
        const actions = document.getElementById('overlay-actions');
        const primaryBtn = document.getElementById('overlay-primary-btn');
        const secondaryBtn = document.getElementById('overlay-secondary-btn');

        showStatus('confirm', title, msg, true);
        actions.classList.remove('hidden');

        primaryBtn.innerText = confirmText;
        secondaryBtn.innerText = cancelText;
        primaryBtn.className = (confirmText === "Delete") ? "primary-btn-full btn-danger" : "primary-btn-full";

        const cleanup = (choice) => {
            overlay.classList.add('hidden');
            primaryBtn.onclick = null;
            secondaryBtn.onclick = null;
            resolve(choice);
        };

        primaryBtn.onclick = () => cleanup(true);
        secondaryBtn.onclick = () => cleanup(false);
    });
}

/** --- DATA LOADING & REFRESH --- **/

async function loadDancerView() {
    // Show loading overlay
    showStatus('loading', 'Loading Profile', 'Please wait...');

    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    try {
        const resp = await fetch(`${WEB_APP_URL}?action=getHistory&id=${user.chipID}`);
        fullHistoryData = await resp.json();

        // Hide overlay once done
        document.getElementById('master-overlay').classList.add('hidden');

        document.getElementById('displayName').innerText = user.alias;
        renderHistoryTable(fullHistoryData);

        // TODO: Future improvement - Check 'FeedbackGiven' column from backend instead of localStorage
        const hasUnlocked = !!localStorage.getItem('lastFeedback');
        if (hasUnlocked) {
            const statsSection = document.getElementById('stats-section');
            statsSection.classList.remove('stats-locked');
            statsSection.classList.add('stats-unlocked');

            document.getElementById('stats-placeholder').classList.add('hidden');
            document.getElementById('stats-content').classList.remove('hidden');
            calculateAndDisplayStats();

            // Auto-collapse history if unlocked and show toggle button
            toggleHistory(true);
            document.getElementById('toggle-history-btn').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Failed to load view", e);
    }
}

/** --- HISTORY TOGGLE --- **/
window.toggleHistory = function (forceHide = false) {
    const content = document.getElementById('history-content');
    const btn = document.getElementById('toggle-history-btn');
    if (!content || !btn) return;

    const isHidden = content.classList.contains('hidden');

    if (forceHide === true) {
        content.classList.add('hidden');
        btn.innerText = "Show";
    } else if (isHidden) {
        content.classList.remove('hidden');
        btn.innerText = "Hide";
    } else {
        content.classList.add('hidden');
        btn.innerText = "Show";
    }
};

/** --- DANCE INTERACTIONS --- **/

async function handleAutoLog(myID, partnerID) {
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=logDance&scannerId=${myID}&targetId=${partnerID}`);
        const result = await resp.json();

        if (result.status === "Unregistered") {
            showStatus('error', 'Unknown Chip', 'This chip is not linked to a dancer yet.');
        } else if (result.status === "Confirmed") {
            showStatus('success', 'Dance Confirmed!', 'Double-tap handshake complete.');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
            showStatus('success', 'Dance Logged', 'Waiting for partner to scan back.');
             // Single short pulse for "Logged but waiting"
             if (navigator.vibrate) {
                navigator.vibrate(100); 
            }
        }

        // Only reload view if it was a valid interaction (not unregistered)
        if (result.status !== "Unregistered") {
            loadDancerView();
        }
    } catch (e) {
        // --- ERROR VIBRATION ---
        // Three rapid short pulses for error
        if (navigator.vibrate) {
            navigator.vibrate([50, 50, 50, 50, 50]); 
        }
        showStatus('error', 'Tap Failed', 'Check your internet connection.');
    }
}

window.confirmDanceManually = async function (rowId) {
    try {
        await fetch(`${WEB_APP_URL}?action=confirmManual&rowId=${rowId}`);
        showStatus('success', 'Confirmed', 'Dance added to your history.');
        loadDancerView();
    } catch (e) {
        showStatus('error', 'Error', 'Could not confirm.');
    }
};

async function cancelDance(rowId) {
    const confirmed = await confirmAction("Delete Log?", "This will remove the pending dance from your history.", "Delete");
    if (confirmed) {
        try {
            await fetch(`${WEB_APP_URL}?action=cancelDance&rowId=${rowId}`);
            showStatus('success', 'Deleted', 'Log removed.');
            loadDancerView();
        } catch (e) {
            showStatus('error', 'Error', 'Failed to delete.');
        }
    }
}

/** --- UI RENDERING & FILTERING --- **/

function renderHistoryTable(data) {
    const tbody = document.getElementById('historyBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color: #999;">No matches found.</td></tr>';
        return;
    }

    const sortedData = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    tbody.innerHTML = sortedData.map(row => {
        const date = new Date(row.timestamp);
        const timeStr = `${date.toLocaleDateString([], { weekday: 'short' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const isConfirmed = row.status === 'Confirmed';

        let statusHtml = '';
        if (isConfirmed) {
            statusHtml = `<span class="status-pill status-confirmed">Confirmed</span>`;
        } else if (row.isTarget) {
            statusHtml = `<button class="status-pill" onclick="confirmDanceManually('${row.rowId}')">Confirm?</button>`;
        } else {
            statusHtml = `
                <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end;">
                    <span class="status-pill status-waiting">Waiting</span>
                    <button onclick="cancelDance('${row.rowId}')" style="background:none; color:var(--error); width:auto; padding:5px; font-size:1.4rem; border:none;">&times;</button>
                </div>`;
        }

        return `<tr>
            <td><strong>${row.partnerAlias}</strong></td>
            <td><small style="color: #888;">${timeStr}</small></td>
            <td style="text-align: right;">${statusHtml}</td>
        </tr>`;
    }).join('');
}

function filterHistory(type) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`filter-${type.toLowerCase()}`).classList.add('active');

    if (type === 'all') {
        renderHistoryTable(fullHistoryData);
    } else if (type === 'Pending') {
        const toConfirm = fullHistoryData.filter(item => item.status === 'Pending' && item.isTarget === true);
        renderHistoryTable(toConfirm);
    }
}

/** --- STATS & REGISTRATION --- **/

function calculateStats(data) {
    const confirmed = data.filter(d => d.status === 'Confirmed');

    if (confirmed.length === 0) {
        return { total: 0, peak: "--", unique: 0, favorite: "--" };
    }

    // 2. Peak Hour (Day + Time)
    const timeSlots = confirmed.map(d => {
        const date = new Date(d.timestamp);
        const day = date.toLocaleDateString([], { weekday: 'short' });
        const hour = date.getHours();
        return `${day} ${hour}`; // e.g., "Mon 23"
    });

    const slotCounts = {};
    timeSlots.forEach(slot => { slotCounts[slot] = (slotCounts[slot] || 0) + 1; });
    const peakSlot = Object.keys(slotCounts).reduce((a, b) => slotCounts[a] > slotCounts[b] ? a : b);
    const [pDay, pHour] = peakSlot.split(' ');

    // 3. Unique Partners & Favorite Partner
    const partnerCounts = {};
    const uniquePartners = new Set();
    confirmed.forEach(d => {
        uniquePartners.add(d.partnerAlias);
        partnerCounts[d.partnerAlias] = (partnerCounts[d.partnerAlias] || 0) + 1;
    });

    let favorite = "";
    let maxCount = 0;
    for (const [partner, count] of Object.entries(partnerCounts)) {
        if (count > maxCount) {
            maxCount = count;
            favorite = partner;
        }
    }

    return {
        total: confirmed.length,
        peak: `${pDay} ${pHour}:00`,
        unique: uniquePartners.size,
        favorite: favorite || "--"
    };
}

function updateStatsUI(stats) {
    document.getElementById('stat-total').innerText = stats.total;
    document.getElementById('stat-peak').innerText = stats.peak;
    document.getElementById('stat-unique').innerText = stats.unique;
    document.getElementById('stat-favorite').innerText = stats.favorite;
}

function calculateAndDisplayStats() {
    const updateBtn = document.getElementById('update-stats-container');

    // 1. Check for Frozen Stats (Snapshot)
    const frozen = localStorage.getItem('frozenStats');
    if (frozen) {
        updateStatsUI(JSON.parse(frozen));
        if (updateBtn) {
            updateBtn.classList.remove('hidden');
            const p = updateBtn.querySelector('p');
            if (p) p.innerText = "Stats are frozen at the time of feedback.";
        }
        return;
    }

    // 2. Fallback: Calculate Live
    const stats = calculateStats(fullHistoryData);
    updateStatsUI(stats);
    if (updateBtn) {
        updateBtn.classList.remove('hidden');
        const p = updateBtn.querySelector('p');
        if (p) p.innerText = "Viewing live stats. Submit feedback to save a snapshot.";
    }
}

window.redoFeedback = function () {
    showFeedbackForm();
};

async function checkUserInSystem(id) {
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=check&id=${id}`);
        const result = await resp.json();
        if (result.registered) {
            // Ask for confirmation before logging in automatically
            confirmAction(`Welcome back!`, `Log in as ${result.alias}?`, "Yes, Login", "Oops, not me").then(shouldLogin => {
                if (shouldLogin) {
                    // Update local storage with backend data
                    if (result.feedbackGiven) {
                        // We use existence of lastFeedback as the 'unlocked' flag.
                        // If it's missing (new device), set a marker so stats appear unlocked.
                        if (!localStorage.getItem('lastFeedback')) {
                            localStorage.setItem('lastFeedback', JSON.stringify({ imported: true }));
                        }
                    }

                    localStorage.setItem('danceAppUser', JSON.stringify({
                        chipID: id, alias: result.alias, role: result.role, userKey: result.storedKey
                    }));
                    location.reload();
                } else {
                    // User denied, maybe show scan status again
                    showStatus('error', 'Login Cancelled', 'Tap another chip or try again.');
                }
            });
        } else {
            showView('registration-view');
        }
    } catch (e) {
        showStatus('error', 'Connection Error', 'Please tap again.');
    }
}

document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    const roleValue = document.getElementById('role').value;
    if (!e.target.checkValidity() || !roleValue) return;

    const userKey = Math.random().toString(36).substring(2, 8).toUpperCase();
    const payload = {
        action: "register",
        chipID: idFromURL,
        userKey: userKey,
        alias: document.getElementById('alias').value.trim(),
        fullName: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        role: roleValue,
        igUser: document.getElementById('igUser').value.trim().replace('@', ''),
        consent: true
    };

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerText = "Linking...";
    submitBtn.disabled = true;

    try {
        await fetch(WEB_APP_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        showStatus('success', 'Chip Linked!', 'Welcome to the festival.');
        setTimeout(() => {
            localStorage.setItem('danceAppUser', JSON.stringify({
                chipID: idFromURL, alias: payload.alias, userKey: userKey, role: payload.role
            }));
            location.reload();
        }, 2000);
    } catch (error) {
        showStatus('error', 'Failed', 'Try linking again.');
        submitBtn.disabled = false;
    }
};

// (Legacy static form handler removed)

/**
 * Global variable to store the structure of the current feedback form
 */
let currentFeedbackTemplate = [];

// (Function moved to end of file to support pre-filling)

/**
 * Builds the HTML for the form based on the template
 */
function renderDynamicFeedback(template) {
    const container = document.getElementById('dynamic-questions-container');
    let html = '';
    let currentCategory = '';

    template.forEach(q => {
        // 1. Check if we need to insert a Category Subheader
        if (q.category && q.category !== currentCategory) {
            currentCategory = q.category;
            html += `<h4 class="form-category-header">${currentCategory}</h4>`;
        }

        // 2. Build the question input
        let inputHtml = '';
        if (q.type === 'scale') {
            // Star Interaction Widget (with touch support)
            inputHtml = `
            <div class="star-rating" id="stars_${q.id}" 
                 ontouchmove="handleStarTouch(event, '${q.id}')"
                 onclick="handleStarTouch(event, '${q.id}')">
                <span class="star-icon" data-val="1">★</span>
                <span class="star-icon" data-val="2">★</span>
                <span class="star-icon" data-val="3">★</span>
                <span class="star-icon" data-val="4">★</span>
                <span class="star-icon" data-val="5">★</span>
            </div>
            <input type="hidden" id="q_${q.id}">
            `;
        } else if (q.type === 'select') {
            inputHtml = `<select id="q_${q.id}" ${q.required ? 'required' : ''}>
                <option value="" disabled selected>Select...</option>
                ${q.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>`;
        } else if (q.type === 'textarea') {
            inputHtml = `<textarea id="q_${q.id}" rows="2" ${q.required ? 'required' : ''}></textarea>`;
        } else {
            inputHtml = `<input type="text" id="q_${q.id}" ${q.required ? 'required' : ''}>`;
        }

        html += `
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="font-weight:bold; font-size: 0.85rem; color: var(--text-primary);">
                    ${q.label} ${q.required ? '<span style="color:var(--error)">*</span>' : ''}
                </label>
                ${inputHtml}
            </div>`;
    });

    container.innerHTML = html;

    // Attach listeners for real-time validation
    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', validateFeedbackForm);
        input.addEventListener('change', validateFeedbackForm);
    });

    // Initial validation state
    validateFeedbackForm();
}

/**
 * Handle Star Interactions (Touch & Click)
 */
window.handleStarTouch = function (e, qId) {
    // Determine the interaction point (Touch or Mouse)
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const container = document.getElementById(`stars_${qId}`);

    // Get position relative to the star container
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const x = clientX - rect.left;

    // Calculate 1-5 rating based on width percentage
    let rating = Math.ceil((x / width) * 5);
    if (rating < 1) rating = 1;
    if (rating > 5) rating = 5;

    // 1. Set hidden input
    const input = document.getElementById(`q_${qId}`);
    if (input) input.value = rating;

    // 2. Update visuals
    const stars = container.querySelectorAll('.star-icon');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });

    if (e.type === 'touchmove') e.preventDefault(); // Prevent scrolling while dragging

    validateFeedbackForm();
};

/**
 * Handles dynamic data collection and submission
 */
document.getElementById('feedbackForm').onsubmit = async (e) => {
    e.preventDefault();
    const user = JSON.parse(localStorage.getItem('danceAppUser'));

    const submitBtn = document.getElementById('feedbackSubmitBtn');
    submitBtn.innerText = "Saving...";
    submitBtn.disabled = true;

    // Dynamically collect all answers based on current template IDs
    const answers = {
        action: 'submitFeedback',
        chipID: user.chipID
    };

    let firstMissing = null;

    for (const q of currentFeedbackTemplate) {
        const element = document.getElementById(`q_${q.id}`);
        if (element) {
            const val = element.value;
            // specific check for star ratings (which used hidden inputs)
            if (q.required && !val) {
                firstMissing = q;
                break;
            }
            answers[q.id] = val;
        }
    }

    if (firstMissing) {
        showStatus('error', 'Missing Info', `Please provide: ${firstMissing.label}`);
        submitBtn.innerText = "Submit & Unlock Highlights";
        submitBtn.disabled = false;
        return;
    }

    // 4. Save "Frozen Stats" (Snapshot) to localStorage
    const currentStats = calculateStats(fullHistoryData);
    localStorage.setItem('frozenStats', JSON.stringify(currentStats));

    // Check if this is an update (key exists) BEFORE checking validation failure or saving new ones
    // But we need to do it before overwriting.
    const isUpdate = !!localStorage.getItem('lastFeedback');

    // 5. Save Answers for Pre-filling
    const answersToSave = {};
    currentFeedbackTemplate.forEach(q => {
        const el = document.getElementById(`q_${q.id}`);
        if (el) answersToSave[q.id] = el.value;
    });
    localStorage.setItem('lastFeedback', JSON.stringify(answersToSave));

    try {
        await fetch(WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(answers)
        });

        hideFeedback();

        if (isUpdate) {
            showStatus('success', 'Stats Refreshed!', 'Your feedback has been updated.');
        } else {
            showStatus('success', 'Highlights Unlocked!', 'Enjoy your stats.');
        }
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        showStatus('error', 'Error', 'Failed to save feedback.');
        submitBtn.innerText = "Submit & Unlock Highlights";
        submitBtn.disabled = false;
    }
};


/** --- UTILS --- **/

function showView(viewId) {
    ['scan-view', 'registration-view', 'dancer-view', 'organizer-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
}

window.selectRole = function (roleValue) {
    document.getElementById('role').value = roleValue;
    document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));

    // Visually highlight the selected button
    const btn = document.getElementById('btn-' + roleValue.toLowerCase());
    if (btn) btn.classList.add('active');

    validateFormState();
};

function validateFeedbackForm() {
    const submitBtn = document.getElementById('feedbackSubmitBtn');
    if (!submitBtn) return;

    let isValid = true;
    for (const q of currentFeedbackTemplate) {
        if (q.required) {
            const el = document.getElementById(`q_${q.id}`);
            if (!el || !el.value) {
                isValid = false;
                break;
            }
        }
    }

    submitBtn.disabled = !isValid;
    if (isValid) {
        submitBtn.classList.remove('btn-locked');
    } else {
        submitBtn.classList.add('btn-locked');
    }
}

function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;

    // Check form validity (HTML5 constraints + Role selection)
    const isFormValid = form.checkValidity() && document.getElementById('role').value !== "";

    submitBtn.disabled = !isFormValid;

    // Toggle visual class
    if (isFormValid) {
        submitBtn.classList.remove('btn-locked');
    } else {
        submitBtn.classList.add('btn-locked');
    }
}

window.unlinkChip = function () {
    confirmAction("Unlink Chip?", "You will need to scan your chip again to log in.", "Unlink").then(choice => {
        if (choice) {
            localStorage.removeItem('danceAppUser');
            localStorage.removeItem('frozenStats'); // Clear stats on unlink
            localStorage.removeItem('lastFeedback'); // Clear feedback on unlink
            location.reload();
        }
    });
};

/* Expose functions to window for HTML access */
window.hideFeedback = function () { document.getElementById('feedback-overlay').classList.add('hidden'); }

/**
 * Triggered when user clicks "Unlock Now" OR "Update Feedback"
 */
window.showFeedbackForm = async function () {
    showStatus('loading', 'Loading Survey', 'Please wait...');

    try {
        if (currentFeedbackTemplate.length === 0) {
            const resp = await fetch(`${WEB_APP_URL}?action=getFeedbackTemplate`);
            currentFeedbackTemplate = await resp.json();
        }

        // Hide loading overlay
        document.getElementById('master-overlay').classList.add('hidden');

        renderDynamicFeedback(currentFeedbackTemplate);

        // --- PRE-FILL LOGIC ---
        const lastData = JSON.parse(localStorage.getItem('lastFeedback'));
        if (lastData) {
            currentFeedbackTemplate.forEach(q => {
                const val = lastData[q.id];
                if (val) {
                    const field = document.getElementById(`q_${q.id}`);
                    if (field) field.value = val;
                    // Update visuals for stars
                    if (q.type === 'scale') {
                        // We need to call the window function to update UI
                        if (window.handleStarTouch) {
                            // Simulate update
                            const container = document.getElementById(`stars_${q.id}`);
                            const stars = container.querySelectorAll('.star-icon');
                            stars.forEach((star, index) => {
                                if (index < val) star.classList.add('active');
                            });
                        }
                    }
                }
            });

            // Change button text to "Update"
            const submitBtn = document.getElementById('feedbackSubmitBtn');
            if (submitBtn) submitBtn.innerText = "Update & Refresh Stats";
        }

        document.getElementById('master-overlay').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.remove('hidden');
    } catch (e) {
    }
};
