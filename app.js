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
    // Force the app to wait for the secure connection to finish FIRST
    if (db.initializeDatabaseConnection) {
        await db.initializeDatabaseConnection();
    }

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

/** --- SECURITY / TEXT HELPERS --- **/

// Escapes user-generated content (aliases, confessions) before injecting into HTML.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

            const histPref = localStorage.getItem('historyVisible');
            applyHistoryVisibility(histPref === '1');
            document.getElementById('toggle-history-btn').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Failed to load view", e);
        if (!cachedHistory) showStatus('error', 'No Connection', 'Could not load your profile.');
    }

    // Lazy-load the current confession into the editor (non-blocking)
    loadConfessionEditor(user.chip_id);
}

async function loadConfessionEditor(chip_id) {
    const box = document.getElementById('confession-edit');
    if (!box || box.dataset.loaded === "1") return;
    try {
        const current = await db.getConfession(chip_id);
        box.value = current;
        box.dataset.loaded = "1";
        const counter = document.getElementById('confession-edit-counter');
        if (counter) counter.textContent = `${current.length} / 120`;
    } catch (e) {
        console.warn("Could not load confession:", e);
    }
}

window.saveConfession = async function () {
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    const box = document.getElementById('confession-edit');
    if (!user || !box) return;

    const btn = document.getElementById('save-confession-btn');
    if (btn) { btn.disabled = true; btn.innerText = 'Saving...'; }

    try {
        await db.updateConfession(user.chip_id, box.value.trim());
        showStatus('success', 'Saved!', 'Your ice-breaker is updated.');
    } catch (e) {
        console.error("Confession save failed:", e);
        showStatus('error', 'Error', 'Could not save. Try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = 'Save Ice-Breaker'; }
    }
};

// Shared collapsible section toggle
function toggleSection(bodyId, iconId) {
    const body = document.getElementById(bodyId);
    const icon = document.getElementById(iconId);
    if (!body) return false;
    const isHidden = body.classList.toggle('hidden');
    if (icon) icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(90deg)';
    return !isHidden; // returns true if now visible
}

window.toggleConfessionEditor = function () {
    toggleSection('confession-body', 'confession-toggle-icon');
};

// Character counter for profile ice-breaker textarea
(function initConfessionEditCounter() {
    const box = document.getElementById('confession-edit');
    if (!box) return;
    box.addEventListener('input', () => {
        const counter = document.getElementById('confession-edit-counter');
        if (counter) counter.textContent = `${box.value.length} / 120`;
    });
})();

function renderUserProfile(user) {
    document.getElementById('displayName').innerText = user.alias;
    const roleEmoji = user.role === 'Leader' ? '🕺' : (user.role === 'Follower' ? '💃' : '✨');
    const metaStr = user.country
        ? `🌍 ${escapeHtml(user.country)} &nbsp;|&nbsp; ${roleEmoji} ${escapeHtml(user.role)}`
        : `${roleEmoji} ${escapeHtml(user.role)}`;
    document.getElementById('displayMeta').innerHTML = metaStr;
}

/** --- DANCE INTERACTIONS --- **/

async function handleAutoLogWithAutoClose(myID, partnerID) {
    localStorage.removeItem('pending_chip_id');
    showView('auto-close-view');
    document.getElementById('auto-close-status').innerText = "Logging dance...";

    try {
        const result = await db.logDance(myID, partnerID);

        // FIX: these were previously undefined, crashing the success screens.
        const alias = escapeHtml(result.partnerAlias || "your partner");
        const confessionHtml = result.confession
            ? `<div style="margin-top:15px; padding:12px; background:rgba(56,189,248,0.12);
                        border:1px dashed var(--secondary); border-radius:10px;
                        font-size:0.9rem; color:var(--text-secondary); text-align:left;">
                    🧊 <i>"${escapeHtml(result.confession)}"</i>
               </div>`
            : "";

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
        } else if (result.status === "AlreadyLogged") {
            document.getElementById('auto-close-view').innerHTML = `
                <div style="font-size:4rem; margin-bottom:10px;">✅</div>
                <h2 style="color:var(--text-primary);">Already logged</h2>
                <p style="color:var(--text-secondary); margin-top:10px;">Your dance with ${alias} is already confirmed.</p>
                <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
            setTimeout(() => window.close(), 2500);
        } else if (result.status === "Duplicate") {
            document.getElementById('auto-close-view').innerHTML = `
                <div style="font-size:4rem; margin-bottom:10px;">⏳</div>
                <h2 style="color:var(--text-primary);">Already logged</h2>
                <p style="color:var(--text-secondary); margin-top:10px;">Still waiting for ${alias} to scan back (${result.minutesLeft} min left).</p>
                <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
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
        console.error("logDance failed:", e);
        document.getElementById('auto-close-view').innerHTML = `
            <h2>❌ Network Error</h2><p>Could not connect to the server.</p>
            <button class="primary-btn" onclick="window.close()" style="margin-top:20px;">Close Tab</button>`;
    }
}

window.confirmDanceManually = async function (rowId) {
    showStatus('loading', 'Confirming...', 'Please wait.');
    try {
        const res = await db.confirmDance(rowId);
        if (res.success) {
            showStatus('success', 'Confirmed', 'Dance added to your history.');
        } else if (res.currentStatus === 'Cancelled') {
            showStatus('error', 'Not possible', 'This dance was cancelled by your partner.');
        } else if (res.currentStatus === 'Confirmed') {
            showStatus('info', 'Already confirmed', 'This dance was already confirmed.');
        } else {
            showStatus('error', 'Not possible', 'This dance is no longer pending.');
        }
        setTimeout(() => loadDancerView(true), 2500);
    } catch (e) {
        console.error("Confirm failed:", e);
        showStatus('error', 'Error', 'Could not confirm.');
    }
};

window.cancelDance = async function (rowId) {
    const confirmed = await confirmAction("Delete Log?", "Remove this pending dance?", "Delete");
    if (confirmed) {
        showStatus('loading', 'Deleting...', 'Please wait.');
        try {
            const res = await db.cancelDance(rowId);
            if (res.success) {
                showStatus('success', 'Deleted', 'Log removed.');
            } else if (res.currentStatus === 'Confirmed') {
                showStatus('error', 'Too late', 'Your partner already confirmed this dance.');
            } else if (res.currentStatus === 'Cancelled') {
                showStatus('info', 'Already deleted', 'This dance was already removed.');
            } else {
                showStatus('error', 'Not possible', 'This dance is no longer pending.');
            }
            setTimeout(() => loadDancerView(true), 2500);
        } catch (e) {
            console.error("Cancel failed:", e);
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
        console.error("checkUser failed:", e);
        showView('scan-view');
        showStatus('error', 'Connection Error', 'Please tap again.');
    }
}

document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    const roleValue = document.getElementById('role').value;
    if (!e.target.checkValidity() || !roleValue || !aliasAvailable || !emailAvailable) return;

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
        console.error("Registration failed:", error);
        showStatus('error', 'Failed', 'Try linking again.');
        submitBtn.innerText = "Link My Chip";
        submitBtn.disabled = false;
    }
};

/** --- UTILS, UI & GLOBAL EXPORTS --- **/

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

// Converting 'ES' to 🇪🇸
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
            statusHtml = `<button class="status-pill" onclick="confirmDanceManually('${row.rowId}')">Confirm</button>`;
        } else {
            statusHtml = `
                <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end;">
                    <span class="status-pill status-waiting">Waiting</span>
                    <button onclick="cancelDance('${row.rowId}')" style="background:none; color:var(--error); width:auto; padding:5px; font-size:1.4rem; border:none;">&times;</button>
                </div>`;
        }

        const safeAlias = escapeHtml(row.partnerAlias);
        const flag = getFlagEmoji(row.partnerCountry);
        const aliasDisplay = flag ? `<span style="font-size:1.1em; margin-right:4px;">${flag}</span> ${safeAlias}` : safeAlias;

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
    document.getElementById('role-error').style.display = 'none';
    validateFormState();
};

// --- Registration form validation ---

// Track async uniqueness results
let aliasAvailable = true;
let emailAvailable = true;
let aliasCheckTimer = null;
let emailCheckTimer = null;

// Wire up all form inputs to trigger validation on every keystroke/change
(function initRegFormListeners() {
    const fields = ['fullName', 'alias', 'email', 'igUser', 'country', 'confession'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const event = (el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(event, () => validateFormState());
    });

    // Alias: debounced uniqueness check
    const aliasEl = document.getElementById('alias');
    if (aliasEl) {
        aliasEl.addEventListener('input', () => {
            clearTimeout(aliasCheckTimer);
            const val = aliasEl.value.trim();
            if (!val || val.length > 9 || /\s/.test(val)) {
                aliasAvailable = true; // pattern will catch it
                return;
            }
            aliasCheckTimer = setTimeout(async () => {
                try {
                    aliasAvailable = await db.checkAliasAvailable(val);
                    const err = document.getElementById('alias-error');
                    if (!aliasAvailable) {
                        aliasEl.classList.add('is-invalid');
                        err.textContent = 'This alias is already taken';
                        err.style.display = 'block';
                    } else {
                        aliasEl.classList.remove('is-invalid');
                        err.style.display = 'none';
                    }
                } catch (e) {
                    console.warn('Alias check failed', e);
                    aliasAvailable = true; // don't block on network error
                }
                validateFormState();
            }, 400);
        });
    }

    // Email: debounced uniqueness check
    const emailEl = document.getElementById('email');
    if (emailEl) {
        emailEl.addEventListener('input', () => {
            clearTimeout(emailCheckTimer);
            const val = emailEl.value.trim();
            if (!val || !emailEl.validity.valid) {
                emailAvailable = true; // pattern will catch it
                return;
            }
            emailCheckTimer = setTimeout(async () => {
                try {
                    emailAvailable = await db.checkEmailAvailable(val);
                    const err = document.getElementById('email-error');
                    if (!emailAvailable) {
                        emailEl.classList.add('is-invalid');
                        err.textContent = 'This email is already registered';
                        err.style.display = 'block';
                    } else {
                        emailEl.classList.remove('is-invalid');
                        err.style.display = 'none';
                    }
                } catch (e) {
                    console.warn('Email check failed', e);
                    emailAvailable = true;
                }
                validateFormState();
            }, 400);
        });
    }

    // Confession character counter
    const confEl = document.getElementById('confession');
    if (confEl) {
        confEl.addEventListener('input', () => {
            const counter = document.getElementById('confession-counter');
            if (counter) counter.textContent = `${confEl.value.length} / 120`;
        });
    }
})();

function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;

    const roleSelected = document.getElementById('role').value !== '';
    const isFormValid = form.checkValidity() && roleSelected && aliasAvailable && emailAvailable;

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

function applyHistoryVisibility(visible) {
    const content = document.getElementById('history-content');
    const icon = document.getElementById('history-toggle-icon');
    if (!content) return;
    content.classList.toggle('hidden', !visible);
    if (icon) icon.style.transform = visible ? 'rotate(90deg)' : 'rotate(0deg)';
}

window.toggleHistory = function () {
    const nowVisible = toggleSection('history-content', 'history-toggle-icon');
    localStorage.setItem('historyVisible', nowVisible ? '1' : '0');
};

window.filterHistory = function (type) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`filter-${type.toLowerCase()}`).classList.add('active');
    if (type === 'all') renderHistoryTable(fullHistoryData);
    else if (type === 'Pending') renderHistoryTable(fullHistoryData.filter(item => item.status === 'Pending' && item.isTarget === true));
};

/** --- FEEDBACK FORM & SUBMISSION --- **/

let currentFeedbackTemplate = [];

window.validateFeedbackForm = function () {
    const submitBtn = document.getElementById('feedbackSubmitBtn');
    if (!submitBtn) return;

    let isValid = true;
    currentFeedbackTemplate.forEach(q => {
        if (q.required) {
            const input = document.getElementById(`q_${q.id}`);
            if (!input || !input.value.trim()) isValid = false;
        }
    });

    submitBtn.disabled = !isValid;
    if (isValid) {
        submitBtn.classList.remove('btn-locked');
    } else {
        submitBtn.classList.add('btn-locked');
    }
};

window.handleStarTouch = function (e, qId) {
    if (e.type === 'touchmove') e.preventDefault();

    let rating = 0;

    if (e.type === 'click') {
        const star = e.target.closest('.star-icon');
        if (!star) return;
        rating = parseInt(star.getAttribute('data-val'), 10);
    }
    else if (e.type === 'touchmove') {
        const touch = e.touches[0];
        const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);

        if (!elementUnderFinger || !elementUnderFinger.classList.contains('star-icon')) return;
        rating = parseInt(elementUnderFinger.getAttribute('data-val'), 10);
    }

    if (!rating || rating < 1) return;

    // 1. Set the hidden input value
    const input = document.getElementById(`q_${qId}`);
    if (input) input.value = rating;

    // 2. Instantly update the visual UI
    const container = document.getElementById(`stars_${qId}`);
    const stars = container.querySelectorAll('.star-icon');

    stars.forEach((starEl, index) => {
        if (index < rating) {
            starEl.classList.add('active');
        } else {
            starEl.classList.remove('active');
        }
    });

    validateFeedbackForm();
};

function renderDynamicFeedback(template) {
    const container = document.getElementById('dynamic-questions-container');
    let html = '';
    let currentCategory = '';

    template.forEach(q => {
        if (q.category && q.category !== currentCategory) {
            currentCategory = q.category;
            html += `<h4 class="form-category-header">${escapeHtml(currentCategory)}</h4>`;
        }

        let inputHtml = '';
        if (q.type === 'scale') {
            // Determine max stars from database options
            let maxStars = 5;
            if (q.options) {
                const parts = q.options.toString().split(',');
                maxStars = parts.length > 1 ? parts.length : parseInt(parts[0], 10);
            }
            if (isNaN(maxStars) || maxStars <= 0) maxStars = 5;

            let starsHtml = '';
            for (let i = 1; i <= maxStars; i++) {
                starsHtml += `<span class="star-icon" data-val="${i}">★</span>`;
            }

            inputHtml = `
            <div class="star-rating" id="stars_${q.id}"
                 ontouchmove="handleStarTouch(event, '${q.id}')"
                 onclick="handleStarTouch(event, '${q.id}')">
                ${starsHtml}
            </div>
            <input type="hidden" id="q_${q.id}">
            `;
        } else if (q.type === 'select') {
            // Convert Supabase TEXT string into an Array
            let optionsArray = [];
            if (q.options) {
                optionsArray = typeof q.options === 'string' ? q.options.split(',').map(s => s.trim()) : [];
            }
            inputHtml = `<select id="q_${q.id}" ${q.required ? 'required' : ''}>
                <option value="" disabled selected>Select...</option>
                ${optionsArray.map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
            </select>`;
        } else if (q.type === 'textarea') {
            inputHtml = `<textarea id="q_${q.id}" rows="2" ${q.required ? 'required' : ''}></textarea>`;
        } else {
            inputHtml = `<input type="text" id="q_${q.id}" ${q.required ? 'required' : ''}>`;
        }

        html += `
            <div class="input-group" style="margin-bottom: 20px;">
                <label style="font-weight:bold; font-size: 0.85rem; color: var(--text-primary);">
                    ${escapeHtml(q.label)} ${q.required ? '<span style="color:var(--error)">*</span>' : ''}
                </label>
                ${inputHtml}
            </div>`;
    });

    container.innerHTML = html;

    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', validateFeedbackForm);
        input.addEventListener('change', validateFeedbackForm);
    });

    validateFeedbackForm();
}

// Pre-fill previously submitted answers (used when redoing feedback)
function prefillFeedback(existing) {
    if (!existing) return;
    currentFeedbackTemplate.forEach(q => {
        const value = existing[q.id];
        if (value === null || value === undefined || value === "") return;

        const input = document.getElementById(`q_${q.id}`);
        if (!input) return;
        input.value = value;

        // Repaint stars for scale questions
        if (q.type === 'scale') {
            const container = document.getElementById(`stars_${q.id}`);
            if (container) {
                container.querySelectorAll('.star-icon').forEach((starEl, index) => {
                    starEl.classList.toggle('active', index < Number(value));
                });
            }
        }
    });
    validateFeedbackForm();
}

window.showFeedbackForm = async function (prefill = false) {
    showStatus('loading', 'Loading Survey', 'Please wait...');
    try {
        if (currentFeedbackTemplate.length === 0) {
            currentFeedbackTemplate = await db.getFeedbackTemplate();
        }
        document.getElementById('master-overlay').classList.add('hidden');
        renderDynamicFeedback(currentFeedbackTemplate);

        if (prefill) {
            const user = JSON.parse(localStorage.getItem('danceAppUser'));
            if (user) {
                const existing = await db.getUserFeedback(user.chip_id);
                prefillFeedback(existing);
            }
        }

        document.getElementById('feedback-overlay').classList.remove('hidden');
    } catch (e) {
        console.error("Feedback template load failed:", e);
        showStatus('error', 'Error', 'Could not load form.');
    }
};

window.hideFeedback = function () {
    document.getElementById('feedback-overlay').classList.add('hidden');
};

window.redoFeedback = function () {
    currentFeedbackTemplate = [];
    window.showFeedbackForm(true); // pre-fill with previous answers
};

document.getElementById('feedbackForm').onsubmit = async (e) => {
    e.preventDefault();
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    const submitBtn = document.getElementById('feedbackSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Submitting...';

    // Collect answers keyed by q.id, which must match the feedback table columns
    const feedbackData = {};
    currentFeedbackTemplate.forEach(q => {
        const el = document.getElementById(`q_${q.id}`);
        if (el && el.value !== "") {
            if (q.type === 'scale' || q.type === 'number') {
                feedbackData[q.id] = parseInt(el.value, 10);
            } else {
                feedbackData[q.id] = el.value;
            }
        }
    });

    try {
        await db.submitFeedback(user.chip_id, feedbackData);

        // Refresh history and freeze stats snapshot at submit time
        fullHistoryData = await db.getHistory(user.chip_id);
        const snapshot = calculateStats(fullHistoryData);
        localStorage.setItem('frozenStats', JSON.stringify(snapshot));
        localStorage.setItem('lastFeedback', JSON.stringify({ submitted: true }));

        window.hideFeedback();
        showStatus('success', 'Thank you! 🎉', 'Your stats are now unlocked.');

        setTimeout(() => loadDancerView(), 2000);
    } catch (err) {
        // Exact Supabase error in the browser console (e.g. missing column,
        // permission denied for sequence, etc.)
        console.error("Supabase Submission Error:", err);

        showStatus('error', 'Error', 'Could not submit feedback. Try again.');
        submitBtn.disabled = false;
        submitBtn.innerText = 'Submit & Unlock Highlights';
    }
};

/** --- STATS LOGIC --- **/

function calculateStats(data) {
    const confirmed = data.filter(d => d.status === 'Confirmed');

    if (confirmed.length === 0) {
        return { total: 0, peak: "--", unique: 0, favorite: "--" };
    }

    const timeSlots = confirmed.map(d => {
        const date = new Date(d.timestamp);
        const day = date.toLocaleDateString([], { weekday: 'short' });
        const hour = date.getHours();
        return `${day} ${hour}`;
    });

    const slotCounts = {};
    timeSlots.forEach(slot => { slotCounts[slot] = (slotCounts[slot] || 0) + 1; });
    const peakSlot = Object.keys(slotCounts).reduce((a, b) => slotCounts[a] > slotCounts[b] ? a : b);
    const [pDay, pHour] = peakSlot.split(' ');

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
    const grid = document.querySelector('.stat-grid');
    const empty = document.getElementById('stats-empty');

    if (stats.total === 0) {
        if (grid) grid.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
    } else {
        if (grid) grid.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');
        document.getElementById('stat-total').innerText = stats.total;
        document.getElementById('stat-peak').innerText = stats.peak;
        document.getElementById('stat-unique').innerText = stats.unique;
        document.getElementById('stat-favorite').innerText = stats.favorite;
    }
}

function calculateAndDisplayStats() {
    const updateBtn = document.getElementById('update-stats-container');
    const lastFeedback = localStorage.getItem('lastFeedback');

    let frozen = localStorage.getItem('frozenStats');

    // Imported-feedback users may lack a snapshot — create one now
    if (!frozen && lastFeedback) {
        frozen = JSON.stringify(calculateStats(fullHistoryData));
        localStorage.setItem('frozenStats', frozen);
    }

    if (frozen) {
        updateStatsUI(JSON.parse(frozen));
        if (updateBtn) {
            updateBtn.classList.remove('hidden');
            const p = updateBtn.querySelector('p');
            if (p) p.innerText = "Stats are frozen at the time of feedback.";
        }
        return;
    }

    // No feedback submitted yet — show live stats
    const stats = calculateStats(fullHistoryData);
    updateStatsUI(stats);
    if (updateBtn) {
        updateBtn.classList.remove('hidden');
        const p = updateBtn.querySelector('p');
        if (p) p.innerText = "Viewing live stats. Submit feedback to save a snapshot.";
    }
}
