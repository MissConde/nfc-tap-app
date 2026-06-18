/**
 * app.js - UI Controller & State Management (Supabase Edition)
 */
import * as db from './db.js';

const urlParams = new URLSearchParams(window.location.search);
const idFromURL = urlParams.get('id');
let fullHistoryData = [];

// 1. If ID is in URL, save it immediately.
if (idFromURL) {
    localStorage.setItem('pending_chip_id', idFromURL);
}

// 2. Retrieve ID: Use URL first, fallback to pending_chip_id
const activeChipId = idFromURL || localStorage.getItem('pending_chip_id');

window.onload = async () => {
    const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

    if (savedUser && savedUser.chip_id) {
        showView('dancer-view');
        loadDancerView();

        if (activeChipId && activeChipId !== savedUser.chip_id) {
            handleAutoLogWithAutoClose(savedUser.chip_id, activeChipId);
        }
    } else if (activeChipId) {
        showStatus('loading', 'Loading...', 'Please wait.');
        checkUserInSystem(activeChipId);
    } else {
        showView('scan-view');
        document.getElementById('scan-status').innerText = "Please tap your NFC chip to begin.";
    }

    validateFormState();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            const user = JSON.parse(localStorage.getItem('danceAppUser'));
            if (user && user.chip_id && !document.getElementById('dancer-view').classList.contains('hidden')) {
                loadDancerView(true);
            }
        }
    });
};

/** --- DATA LOADING & REFRESH --- **/

async function loadDancerView(silent = false) {
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    const cachedHistory = localStorage.getItem('cachedHistory');
    if (cachedHistory) {
        fullHistoryData = JSON.parse(cachedHistory);
        if (!silent) document.getElementById('master-overlay').classList.add('hidden');
        renderUserProfile(user);
        renderHistoryTable(fullHistoryData);
    } else {
        if (!silent) showStatus('loading', 'Loading...', 'Please wait...');
    }

    try {
        // CALLING SUPABASE LAYER
        fullHistoryData = await db.getHistory(user.chip_id);
        localStorage.setItem('cachedHistory', JSON.stringify(fullHistoryData));

        document.getElementById('master-overlay').classList.add('hidden');
        renderUserProfile(user);
        renderHistoryTable(fullHistoryData);

        const hasUnlocked = !!localStorage.getItem('lastFeedback');
        if (hasUnlocked) {
            const statsSection = document.getElementById('stats-section');
            statsSection.classList.remove('stats-locked');
            statsSection.classList.add('stats-unlocked');

            document.getElementById('stats-placeholder').classList.add('hidden');
            document.getElementById('stats-content').classList.remove('hidden');
            calculateAndDisplayStats();

            if (!window._historyInitialized) {
                toggleHistory(true);
                window._historyInitialized = true;
            }
            document.getElementById('toggle-history-btn').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Failed to load view", e);
        if (!cachedHistory) showStatus('error', 'No Connection', 'Could not load your profile.');
    }
}

function renderUserProfile(user) {
    document.getElementById('displayName').innerText = user.alias;
    const roleEmoji = user.role === 'Leader' ? '🕺' : (user.role === 'Follower' ? '💃' : '✨');
    const metaStr = user.country ? `🌍 ${user.country} &nbsp;|&nbsp; ${roleEmoji} ${user.role}` : `${roleEmoji} ${user.role}`;
    document.getElementById('displayMeta').innerHTML = metaStr;
}

/** --- DANCE INTERACTIONS --- **/

async function handleAutoLogWithAutoClose(myID, partnerID) {
    localStorage.removeItem('pending_chip_id');
    showView('auto-close-view');
    document.getElementById('auto-close-status').innerText = "Logging dance...";

    try {
        // CALLING SUPABASE LAYER
        const result = await db.logDance(myID, partnerID);

        if (result.status === "Unregistered") {
            document.getElementById('auto-close-view').innerHTML = `
                <h2>❌ Unknown Chip</h2><p>This chip hasn't been registered yet.</p>
                <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
        } else if (result.status === "Confirmed") {
            document.getElementById('auto-close-view').innerHTML = `
                <div style="font-size:4rem; margin-bottom:10px;">🔥</div>
                <h2 style="color:var(--success);">It's a Match!</h2>
                <p style="color:var(--text-secondary); margin-top:10px;">You and ${alias} are locked in!</p>
                ${confessionHtml}
                <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            setTimeout(() => window.close(), 2500);
        } else {
            document.getElementById('auto-close-view').innerHTML = `
                <div style="font-size:4rem; margin-bottom:10px;">✨</div>
                <h2 style="color:var(--success);">Enjoy the dance!</h2>
                <p style="color:var(--text-secondary); margin-top:10px;">Waiting for ${alias} to scan back.</p>
                ${confessionHtml}
                <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;  
            if (navigator.vibrate) navigator.vibrate(100);
            setTimeout(() => window.close(), 2500);
        }
    } catch (e) {
        document.getElementById('auto-close-view').innerHTML = `
            <h2>❌ Network Error</h2><p>Could not connect to the server.</p>
            <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
    }
}

window.confirmDanceManually = async function (rowId) {
    showStatus('loading', 'Confirming...', 'Please wait.');
    try {
        await db.updateDanceStatus(rowId, 'Confirmed');
        showStatus('success', 'Confirmed', 'Dance added to your history.');
        loadDancerView();
    } catch (e) {
        showStatus('error', 'Error', 'Could not confirm.');
    }
};

window.cancelDance = async function (rowId) {
    const confirmed = await confirmAction("Delete Log?", "Remove this pending dance?", "Delete");
    if (confirmed) {
        showStatus('loading', 'Deleting...', 'Please wait.');
        try {
            await db.updateDanceStatus(rowId, 'Cancelled');
            showStatus('success', 'Deleted', 'Log removed.');
            loadDancerView();
        } catch (e) {
            showStatus('error', 'Error', 'Failed to delete.');
        }
    }
};

/** --- REGISTRATION & LOGIN --- **/

async function checkUserInSystem(id) {
    try {
        const result = await db.checkUser(id);
        
        if (result.registered) {
            document.getElementById('master-overlay').classList.add('hidden');
            confirmAction(`Welcome back!`, `Log in as ${result.alias}?`, "Yes, Login", "Oops, not me").then(shouldLogin => {
                if (shouldLogin) {
                    if (result.feedbackGiven && !localStorage.getItem('lastFeedback')) {
                        localStorage.setItem('lastFeedback', JSON.stringify({ imported: true }));
                    }
                    localStorage.setItem('danceAppUser', JSON.stringify({
                        chip_id: id, alias: result.alias, role: result.role, country: result.country, user_key: result.user_key
                    }));
                    localStorage.removeItem('pending_chip_id');
                    location.reload();
                } else {
                    localStorage.removeItem('pending_chip_id');
                    showStatus('error', 'Canceled', 'You may close this tab.');
                    setTimeout(() => window.close(), 2000);
                }
            });
        } else {
            document.getElementById('master-overlay').classList.add('hidden');
            showView('registration-view');
        }
    } catch (e) {
        showView('scan-view');
        showStatus('error', 'Connection Error', 'Please tap again.');
    }
}

document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    const roleValue = document.getElementById('role').value;
    if (!e.target.checkValidity() || !roleValue) return;

    const user_key = Math.random().toString(36).substring(2, 8).toUpperCase();
    const chip_id = idFromURL || localStorage.getItem('pending_chip_id');

    // Mapped to snake_case schema
    const payload = {
        chip_id: chip_id,
        user_key: user_key,
        alias: document.getElementById('alias').value.trim(),
        full_name: document.getElementById('fullName').value.trim(),
        country: document.getElementById('country').value,
        email: document.getElementById('email').value.trim(),
        role: roleValue,
        ig_user: document.getElementById('igUser').value.trim().replace('@', ''),
        confession: document.getElementById('confession').value.trim(),
        consent: true
    };

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerText = "Linking...";
    submitBtn.disabled = true;

    try {
        await db.registerUser(payload);
        showStatus('success', 'Chip Linked!', 'Welcome to the festival.');
        setTimeout(() => {
            localStorage.setItem('danceAppUser', JSON.stringify({
                chip_id: chip_id, alias: payload.alias, user_key: user_key, role: payload.role, country: payload.country
            }));
            localStorage.removeItem('pending_chip_id');
            location.reload();
        }, 2000);
    } catch (error) {
        showStatus('error', 'Failed', 'Try linking again.');
        submitBtn.disabled = false;
    }
};

/** --- UTILS, UI & GLOBAL EXPORTS --- **/
// (Keeping your exact UI logic intact, just exposing HTML functions)

function showView(viewId) {
    ['scan-view', 'registration-view', 'dancer-view', 'organizer-view', 'auto-close-view', 'android-success-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
}

function showStatus(type, title, msg, isModal = false) {
    const overlay = document.getElementById('master-overlay');
    const actions = document.getElementById('overlay-actions');
    const icons = {
        success: document.getElementById('icon-success'),
        error: document.getElementById('icon-error'),
        loading: document.getElementById('icon-loading')
    };

    Object.values(icons).forEach(el => el.classList.add('hidden'));
    if (icons[type]) icons[type].classList.remove('hidden');

    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-msg').innerText = msg;

    actions.classList.add('hidden');
    overlay.classList.remove('hidden');

    if (!isModal && type !== 'loading') {
        setTimeout(() => overlay.classList.add('hidden'), 2000);
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
// Converting 'ES' en 🇪🇸
function getFlagEmoji(countryCode) {
    if (!countryCode) return '';
    const codePoints = countryCode.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

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

        const flag = getFlagEmoji(row.partnerCountry);
        const aliasDisplay = flag ? `<span style="font-size:1.1em; margin-right:4px;">${flag}</span> ${row.partnerAlias}` : row.partnerAlias;
        
        return `<tr>
            <td><strong>${aliasDisplay}</strong></td>
            <td><small style="color: #888;">${timeStr}</small></td>
            <td style="text-align: right;">${statusHtml}</td>
        </tr>`;
    }).join('');
}

// Global functions attached to window for HTML buttons
window.selectRole = function (roleValue) {
    document.getElementById('role').value = roleValue;
    document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById('btn-' + roleValue.toLowerCase());
    if (btn) btn.classList.add('active');
    validateFormState();
};

function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;
    const isFormValid = form.checkValidity() && document.getElementById('role').value !== "";
    submitBtn.disabled = !isFormValid;
    isFormValid ? submitBtn.classList.remove('btn-locked') : submitBtn.classList.add('btn-locked');
}

window.unlinkChip = function () {
    confirmAction("Unlink Chip?", "You will need to scan your chip again to log in.", "Unlink").then(choice => {
        if (choice) {
            localStorage.clear(); // Clear all app data safely
            window.history.replaceState({}, document.title, window.location.pathname);
            location.reload();
        }
    });
};

window.toggleHistory = function (forceHide = false) {
    const content = document.getElementById('history-content');
    const btn = document.getElementById('toggle-history-btn');
    if (!content || !btn) return;
    const isHidden = content.classList.contains('hidden');
    if (forceHide === true || !isHidden) {
        content.classList.add('hidden');
        btn.innerText = "Show";
    } else {
        content.classList.remove('hidden');
        btn.innerText = "Hide";
    }
};

window.filterHistory = function (type) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`filter-${type.toLowerCase()}`).classList.add('active');
    if (type === 'all') renderHistoryTable(fullHistoryData);
    else if (type === 'Pending') renderHistoryTable(fullHistoryData.filter(item => item.status === 'Pending' && item.isTarget === true));
};

// Placeholders for stats visual logic (keeping your existing logic safe)
function calculateStats(data) { /* Same as your old logic */ }
function updateStatsUI(stats) { /* Same as your old logic */ }
function calculateAndDisplayStats() { /* Same as your old logic */ }