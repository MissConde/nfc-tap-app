/**
 * app.js - Optimized for Dance Tracker PWA 2026
 */

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwK7jyCy4hIS4Rrn8zkldPsaneKYpvliMo7t_QjwGjdYCrOThEqimvgfFYj_f85m5IH/exec";
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

function showStatus(type, title, msg, isPersistent = false) {
    const overlay = document.getElementById('master-overlay');
    const successIcon = document.getElementById('icon-success');
    const errorIcon = document.getElementById('icon-error');
    const actions = document.getElementById('overlay-actions');

    // Reset icons and actions
    successIcon.classList.add('hidden');
    errorIcon.classList.add('hidden');
    actions.classList.add('hidden');

    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-msg').innerText = msg;

    if (type === 'success') successIcon.classList.remove('hidden');
    if (type === 'error' || type === 'confirm') errorIcon.classList.remove('hidden');

    overlay.classList.remove('hidden');

    if (!isPersistent) {
        setTimeout(() => overlay.classList.add('hidden'), 2500);
    }
}

function confirmAction(title, msg, confirmText = "Confirm") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('master-overlay');
        const actions = document.getElementById('overlay-actions');
        const primaryBtn = document.getElementById('overlay-primary-btn');
        const secondaryBtn = document.getElementById('overlay-secondary-btn');

        showStatus('confirm', title, msg, true);
        actions.classList.remove('hidden');

        primaryBtn.innerText = confirmText;
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
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    try {
        const resp = await fetch(`${WEB_APP_URL}?action=getHistory&id=${user.chipID}`);
        fullHistoryData = await resp.json();

        document.getElementById('displayName').innerText = user.alias;
        renderHistoryTable(fullHistoryData);

        // TODO: Future improvement - Check 'FeedbackGiven' column from backend instead of localStorage
        const hasUnlocked = localStorage.getItem('statsUnlocked') === 'true';
        if (hasUnlocked) {
            const statsSection = document.getElementById('stats-section');
            statsSection.classList.remove('stats-locked');
            statsSection.classList.add('stats-unlocked');

            document.getElementById('stats-placeholder').classList.add('hidden');
            document.getElementById('stats-content').classList.remove('hidden');
            calculateAndDisplayStats();

            // Auto-collapse history if unlocked
            toggleHistory(true);
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

        if (result.status === "Confirmed") {
            showStatus('success', 'Dance Confirmed!', 'Double-tap handshake complete.');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
            showStatus('success', 'Dance Logged', 'Waiting for partner to scan back.');
        }
        loadDancerView();
    } catch (e) {
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

function calculateAndDisplayStats() {
    const confirmed = fullHistoryData.filter(d => d.status === 'Confirmed');

    // 1. Total Dances
    document.getElementById('stat-total').innerText = confirmed.length;

    if (confirmed.length === 0) {
        document.getElementById('stat-peak').innerText = "--";
        document.getElementById('stat-unique').innerText = "0";
        document.getElementById('stat-favorite').innerText = "--";
        return;
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

    // Find peak slot
    const peakSlot = Object.keys(slotCounts).reduce((a, b) => slotCounts[a] > slotCounts[b] ? a : b);

    // Format: "Mon 23" -> "Mon 23:00"
    const [pDay, pHour] = peakSlot.split(' ');
    document.getElementById('stat-peak').innerText = `${pDay} ${pHour}:00`;

    // 3. Unique Partners & Favorite Partner
    const partnerCounts = {};
    const uniquePartners = new Set();

    confirmed.forEach(d => {
        const p = d.partnerAlias;
        uniquePartners.add(p);
        partnerCounts[p] = (partnerCounts[p] || 0) + 1;
    });

    document.getElementById('stat-unique').innerText = uniquePartners.size;

    // Find Favorite
    let favorite = "";
    let maxCount = 0;
    for (const [partner, count] of Object.entries(partnerCounts)) {
        if (count > maxCount) {
            maxCount = count;
            favorite = partner;
        }
    }
    document.getElementById('stat-favorite').innerText = favorite || "--";
}

async function checkUserInSystem(id) {
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=check&id=${id}`);
        const result = await resp.json();
        if (result.registered) {
            // Update local storage with backend data
            if (result.feedbackGiven) {
                localStorage.setItem('statsUnlocked', 'true');
            }

            localStorage.setItem('danceAppUser', JSON.stringify({
                chipID: id, alias: result.alias, role: result.role, userKey: result.storedKey
            }));
            location.reload();
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

document.getElementById('feedbackForm').onsubmit = async (e) => {
    e.preventDefault();
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    const feedback = {
        action: 'submitFeedback',
        chipID: user.chipID,
        vibe: document.getElementById('vibeRating').value,
        music: document.getElementById('musicRating').value,
        favPartner: document.getElementById('favPartner').value,
        returnChance: document.getElementById('returnChance').value,
        comments: document.getElementById('comments').value
    };

    try {
        await fetch(WEB_APP_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(feedback) });

        // Mark locally so we don't need a roundtrip immediately
        localStorage.setItem('statsUnlocked', 'true');

        hideFeedback();

        // Show success and reload to reveal the new "Unlocked" UI
        showStatus('success', 'Highlights Unlocked!', 'Enjoy your stats.');
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        showStatus('error', 'Error', 'Feedback not saved. Try again.');
    }
};

/**
 * Global variable to store the structure of the current feedback form
 */
let currentFeedbackTemplate = [];

/**
 * Triggered when user clicks "Unlock Now"
 */
window.showFeedbackForm = async function () {
    // Show a small loading status in our master overlay
    showStatus('success', 'Loading...', 'Fetching latest survey...', true);
    
    try {
        // 1. Fetch the template from Google Sheets (FeedbackConfig tab)
        const resp = await fetch(`${WEB_APP_URL}?action=getFeedbackTemplate`);
        currentFeedbackTemplate = await resp.json();
        
        // 2. Build the HTML questions
        renderDynamicFeedback(currentFeedbackTemplate);
        
        // 3. Switch overlays
        document.getElementById('master-overlay').classList.add('hidden');
        document.getElementById('feedback-overlay').classList.remove('hidden');
    } catch (e) {
        showStatus('error', 'Connection Error', 'Could not load feedback questions.');
    }
};

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

        // 2. Build the question input as before
        let inputHtml = '';
        if (q.type === 'select' || q.type === 'scale') {
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
                <label style="font-weight:bold; font-size: 0.85rem; color: var(--text-primary);">${q.label}</label>
                ${inputHtml}
            </div>`;
    });

    container.innerHTML = html;
}

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

    currentFeedbackTemplate.forEach(q => {
        const element = document.getElementById(`q_${q.id}`);
        if (element) {
            answers[q.id] = element.value;
        }
    });

    try {
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            mode: 'no-cors', 
            body: JSON.stringify(answers) 
        });

        localStorage.setItem('statsUnlocked', 'true');
        hideFeedback();
        
        showStatus('success', 'Highlights Unlocked!', 'Enjoy your stats.');
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
    document.getElementById('btn-' + roleValue.toLowerCase()).classList.add('active');
    validateFormState();
};

function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;
    const isFormValid = form.checkValidity() && document.getElementById('role').value !== "";
    submitBtn.disabled = !isFormValid;
}

window.unlinkChip = function () {
    confirmAction("Unlink Chip?", "You will need to scan your chip again to log in.", "Unlink").then(choice => {
        if (choice) {
            localStorage.removeItem('danceAppUser');
            location.reload();
        }
    });
};

/* Expose functions to window for HTML access */
window.hideFeedback = function () { document.getElementById('feedback-overlay').classList.add('hidden'); }