/**
 * app.js - Optimized for Dance Tracker PWA 2026
 */

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby5wet3I48Q1zmUxWo5eHFAycw6wbwGYggHuk3_2IRMaBM1q2ePr78ayQxdVCwjM7p1/exec";
const urlParams = new URLSearchParams(window.location.search);
const idFromURL = urlParams.get('id');
let fullHistoryData = [];

// ── INSTALL PROMPT (captured early, before the browser fires it) ────────────
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Stop the default Chrome mini-bar from appearing.
    _deferredInstallPrompt = e; // Save it so we can trigger it from our own UI.
});

window.onload = async () => {
    const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

    // --- PERSISTENCE FIX ---
    // 1. If ID is in URL (Safari/Browser), save it immediately.
    if (idFromURL) {
        localStorage.setItem('pendingChipId', idFromURL);
    }

    // 2. Retrieve ID: Use URL first, fallback to pendingChipId (for PWA)
    const activeChipId = idFromURL || localStorage.getItem('pendingChipId');

    if (savedUser && savedUser.chipID) {
        // --- LOGGED IN ---
        showView('dancer-view');
        loadDancerView();

        // Check if we scanned a DIFFERENT chip while logged in
        if (activeChipId && activeChipId !== savedUser.chipID) {
            handleAutoLog(savedUser.chipID, activeChipId);
        }
    } else if (activeChipId) {
        // --- NEW CHIP DETECTED (Browser OR PWA) ---
        // Use the persistent ID to triggering the flow
        checkUserInSystem(activeChipId);
    } else {
        // --- PROMPT SCAN ---
        showView('scan-view');
        document.getElementById('scan-status').innerText = "Please tap your NFC chip to begin.";
    }
    validateFormState();
    showInstallPrompt();
};

/** --- INSTALL TO HOME SCREEN PROMPT --- **/

/**
 * Shows a platform-appropriate install banner if:
 * - The app is NOT already running as a standalone PWA
 * - The user hasn't permanently dismissed it
 */
function showInstallPrompt() {
    // Already installed as PWA — no need to prompt.
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
    // User dismissed it before — respect that.
    if (sessionStorage.getItem('installDismissed')) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if (!isIOS && !isAndroid) return; // Desktop — no prompt needed.

    // Build the banner
    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.style.cssText = [
        'position:fixed', 'bottom:0', 'left:0', 'right:0',
        'background:#1e293b', 'color:#fff',
        'padding:14px 18px', 'z-index:2000',
        'display:flex', 'align-items:center', 'gap:12px',
        'box-shadow:0 -3px 16px rgba(0,0,0,0.4)',
        'border-top:2px solid var(--primary)',
        'font-size:0.82rem', 'line-height:1.4'
    ].join(';');

    const icon = isIOS ? '📲' : '📲';
    const instructions = isIOS
        ? `<strong style="color:var(--primary);font-size:0.9rem;">Add to Home Screen</strong><br>
           Tap <strong>⎙ Share</strong> then <strong>"Add to Home Screen"</strong> for the best experience — no notifications, one tab only.`
        : `<strong style="color:var(--primary);font-size:0.9rem;">Install App</strong><br>
           Install the app for the best experience — no notifications, seamless NFC.`;

    banner.innerHTML = `
        <span style="font-size:1.6rem;flex-shrink:0;">${icon}</span>
        <div style="flex:1;">${instructions}</div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
            ${isAndroid ? `<button id="install-accept-btn" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:7px 12px;font-weight:bold;font-size:0.78rem;cursor:pointer;">Install</button>` : ''}
            <button id="install-dismiss-btn" style="background:transparent;color:#888;border:none;font-size:0.75rem;cursor:pointer;padding:4px;">Maybe later</button>
        </div>`;

    document.body.appendChild(banner);

    // Android: trigger native install prompt on button tap
    const acceptBtn = document.getElementById('install-accept-btn');
    if (acceptBtn && _deferredInstallPrompt) {
        acceptBtn.addEventListener('click', async () => {
            banner.remove();
            _deferredInstallPrompt.prompt();
            const { outcome } = await _deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                sessionStorage.setItem('installDismissed', '1');
            }
            _deferredInstallPrompt = null;
        });
    } else if (acceptBtn) {
        // beforeinstallprompt didn't fire (not eligible yet) — hide the install button
        acceptBtn.style.display = 'none';
    }

    // Dismiss permanently
    document.getElementById('install-dismiss-btn').addEventListener('click', () => {
        banner.remove();
        sessionStorage.setItem('installDismissed', '1');
    });
}

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
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    // ── STALE-WHILE-REVALIDATE ──────────────────────────────────────────────
    // 1. Show cached data instantly so the user sees content immediately.
    const cachedHistory = localStorage.getItem('cachedHistory');
    if (cachedHistory) {
        fullHistoryData = JSON.parse(cachedHistory);
        document.getElementById('master-overlay').classList.add('hidden');
        document.getElementById('displayName').innerText = user.alias;
        renderHistoryTable(fullHistoryData);
    } else {
        // No cache yet — show loading overlay until network responds.
        showStatus('loading', 'Loading Profile', 'Please wait...');
    }

    // 2. Fetch fresh data in background, update UI when ready.
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=getHistory&id=${user.chipID}`);
        fullHistoryData = await resp.json();

        // Persist for next load.
        localStorage.setItem('cachedHistory', JSON.stringify(fullHistoryData));

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
        // If network fails but we have cache, that's fine — user already sees data.
        if (!cachedHistory) {
            showStatus('error', 'No Connection', 'Could not load your profile.');
        }
    }

    // 3. Start Web NFC scanning (Android Chrome only — silently ignored on iOS).
    startNfcScanning();
}

/** --- WEB NFC SCANNING (Android Chrome) --- **/

/**
 * Extracts the chip ID from the raw URL string stored on the NFC chip.
 * Handles both full URLs: "https://…?id=XXXX" and plain id strings.
 */
function extractIdFromNfcPayload(payload) {
    try {
        // The chip stores a full URL — parse it like a URL.
        const url = payload.startsWith('http') ? new URL(payload) : new URL('https://x.x?' + payload);
        return url.searchParams.get('id') || null;
    } catch {
        return null;
    }
}

/**
 * Shows or hides the NFC-ready indicator in the dancer view.
 */
function showNfcScanIndicator(active) {
    let indicator = document.getElementById('nfc-scan-indicator');
    if (!indicator) {
        // Create it dynamically so no HTML change needed.
        indicator = document.createElement('div');
        indicator.id = 'nfc-scan-indicator';
        indicator.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px',
            'background:var(--primary)', 'color:#fff',
            'padding:8px 14px', 'border-radius:20px',
            'font-size:0.75rem', 'font-weight:bold',
            'box-shadow:0 2px 10px rgba(0,0,0,0.4)',
            'opacity:0', 'transition:opacity 0.4s',
            'pointer-events:none', 'z-index:1000'
        ].join(';');
        indicator.innerText = '📡 NFC Ready';
        document.body.appendChild(indicator);
    }
    // Fade in/out.
    indicator.style.opacity = active ? '1' : '0';
}

/**
 * Starts the Web NFC reader session.
 * Only available on Android Chrome — silently skipped on iOS and unsupported browsers.
 * Once permission is granted by the user (one-time prompt), subsequent taps are
 * handled entirely in-page: no OS notification, no new tab.
 */
async function startNfcScanning() {
    if (!('NDEFReader' in window)) {
        // iOS or unsupported browser — URL-tap fallback handles it.
        return;
    }

    try {
        const ndef = new NDEFReader();
        await ndef.scan(); // Shows a one-time permission prompt to the user.

        showNfcScanIndicator(true);

        ndef.onreading = ({ message }) => {
            for (const record of message.records) {
                let payload = '';
                try {
                    // URL records use the URL record type.
                    if (record.recordType === 'url') {
                        payload = new TextDecoder().decode(record.data);
                    } else if (record.recordType === 'text') {
                        payload = new TextDecoder().decode(record.data);
                    } else {
                        continue;
                    }
                } catch { continue; }

                const chipId = extractIdFromNfcPayload(payload);
                if (!chipId) continue;

                const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

                if (savedUser && savedUser.chipID) {
                    if (chipId !== savedUser.chipID) {
                        // Logged-in user scanned a different chip → log a dance.
                        handleAutoLog(savedUser.chipID, chipId);
                    }
                    // Ignore tapping your own chip.
                } else {
                    // Not logged in → check if new or returning user.
                    checkUserInSystem(chipId);
                }
                break; // Only process the first valid record.
            }
        };

        ndef.onreadingerror = () => {
            console.warn('NFC read error — chip may not be NDEF formatted.');
        };

    } catch (err) {
        // User denied permission or scan failed — gracefully ignore.
        console.warn('Web NFC unavailable or permission denied:', err);
        showNfcScanIndicator(false);
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
                    // Cleanup pending ID as we are now fully logged in
                    localStorage.removeItem('pendingChipId');
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
    const chipID = idFromURL || localStorage.getItem('pendingChipId');

    const payload = {
        action: "register",
        chipID: chipID,
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
                chipID: chipID, alias: payload.alias, userKey: userKey, role: payload.role
            }));
            // Cleanup pending ID
            localStorage.removeItem('pendingChipId');
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
            localStorage.removeItem('frozenStats');    // Clear stats on unlink
            localStorage.removeItem('lastFeedback');   // Clear feedback on unlink
            localStorage.removeItem('pendingChipId'); // Clear any pending ID
            localStorage.removeItem('cachedHistory'); // Clear history cache on unlink
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
