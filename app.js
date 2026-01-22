// app.js

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzKEAQo8AlKokHvZyYxyCuwWm4IXtMiW6R8R9tW-3pRySryOpKb99lqxNwnIYEPH43L/exec"
const urlParams = new URLSearchParams(window.location.search);
const idFromURL = urlParams.get('id'); // The ID coming from the NFC chip

let fullHistoryData = []; 

window.onload = async () => {
    const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

    if (savedUser && savedUser.chipID) {
        // --- SCENARIO: USER IS ALREADY LINKED ---
        if (idFromURL && idFromURL !== savedUser.chipID) {
            // It's a partner's chip! Log the dance
            handleAutoLog(savedUser.chipID, idFromURL);
        }
        
        showView('dancer-view');
        loadDancerView();
    } else if (idFromURL) {
        // --- SCENARIO: NEW USER TAPPING FOR FIRST TIME ---
        checkUserInSystem(idFromURL);
    } else {
        document.getElementById('scan-status').innerText = "Please tap your NFC chip to begin.";
    }
    // Initialize button state on load
    validateFormState();
};

/** --- DATA LOADING & REFRESH --- **/

async function loadDancerView() {
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    if (!user) return;

    try {
        // 1. Fetch History from Google
        const resp = await fetch(`${WEB_APP_URL}?action=getHistory&id=${user.chipID}`);
        fullHistoryData = await resp.json();
        
        // 2. Update UI Basics
        document.getElementById('displayName').innerText = user.alias;
        
        // 3. Render Table
        renderHistoryTable(fullHistoryData);
        
        // 4. Check Stats Unlock Status
        const hasUnlocked = localStorage.getItem('statsUnlocked') === 'true';
        if (hasUnlocked) {
            document.getElementById('stats-placeholder').classList.add('hidden');
            document.getElementById('stats-content').classList.remove('hidden');
            calculateAndDisplayStats();
        }
    } catch (e) {
        console.error("Failed to load dancer view", e);
    }
}

/**
 * DANCE INTERACTION LOGIC (NFC TAP)
 */

async function handleAutoLog(myID, partnerID) {
    try {
        // We use GET for logDance to keep it fast
        const resp = await fetch(`${WEB_APP_URL}?action=logDance&scannerId=${myID}&targetId=${partnerID}`);
        const result = await resp.json();
        
        const overlay = document.getElementById('success-overlay');
        const title = overlay.querySelector('h3');
        const msg = overlay.querySelector('p');

        if (result.status === "Confirmed") {
            title.innerText = "Dance Confirmed!";
            msg.innerText = "Double-tap handshake complete.";
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
        } else {
            title.innerText = "Dance Logged!";
            msg.innerText = "Waiting for partner to scan you back...";
        }

        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 3000);
        
       // Refresh the UI data
       loadDancerView(); 
    } catch (e) {
        console.error("Auto-log failed", e);
        showError("Dance logging failed. Check connection.");
    }
}

/**
 * BACKUP PLAN: MANUAL APPROVALS
 */

// async function checkPendingApprovals(myID) {
//     try {
//         const resp = await fetch(`${WEB_APP_URL}?action=getPending&id=${myID}`);
//         const pending = await resp.json();
        
//         const container = document.getElementById('pending-approvals');
//         const list = document.getElementById('approvals-list');
        
//         if (pending && pending.length > 0) {
//             container.classList.remove('hidden');
//             list.innerHTML = pending.map(dance => `
//                 <div class="approval-card">
//                     <div class="approval-info">
//                         <strong>${dance.partnerAlias}</strong> scanned you.
//                     </div>
//                     <button class="secondary-btn" onclick="confirmDanceManually('${dance.rowId}')">Confirm</button>
//                 </div>
//             `).join('');
//         } else if (container) {
//             container.classList.add('hidden');
//         }
//     } catch (e) {
//         console.error("Pending check failed", e);
//     }
// }

window.confirmDanceManually = async function(rowId) {
    try {
        await fetch(`${WEB_APP_URL}?action=confirmManual&rowId=${rowId}`);
        loadDancerView(); // Refresh everything
    } catch (e) {
        showError("Manual confirmation failed.");
    }
};

/** --- STATS CALCULATION --- **/

function calculateAndDisplayStats() {
    const confirmed = fullHistoryData.filter(d => d.status === 'Confirmed');
    document.getElementById('totalDances').innerText = confirmed.length;
    
    if (confirmed.length > 0) {
        // Logic for Peak Time
        const hours = confirmed.map(d => new Date(d.timestamp).getHours());
        const peakHour = hours.sort((a,b) =>
              hours.filter(v => v===a).length - hours.filter(v => v===b).length
        ).pop();
        document.getElementById('peakTime').innerText = `${peakHour}:00`;
    }
}

/**
 * REGISTRATION & VALIDATION LOGIC & NAVIGATION
 */

async function checkUserInSystem(id) {
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=check&id=${id}`);
        const result = await resp.json();

        if (result.registered) {
            // Found them! Auto-login
            localStorage.setItem('danceAppUser', JSON.stringify({
                chipID: id,
                alias: result.alias,
                role: result.role,
                userKey: result.storedKey
            }));
            location.reload();
        } else {
            // Not found, go to Registration
            showView('registration-view');
        }
    } catch (e) { showError("Connection error. Please try again."); }
}

document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const roleValue = document.getElementById('role').value;

    if (!form.checkValidity() || !roleValue || form.querySelector('.is-invalid')) {
        form.classList.add('was-validated'); 
        return; 
    }

    const userKey = Math.random().toString(36).substring(2, 8).toUpperCase();
    let igHandle = document.getElementById('igUser').value.trim();
    if (igHandle.startsWith('@')) igHandle = igHandle.substring(1);

    const payload = {
        action: "register",
        chipID: idFromURL,
        userKey: userKey,
        alias: document.getElementById('alias').value.trim(),
        fullName: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        role: roleValue,
        igUser: igHandle,
        consent: true
    };

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerText = "Linking Chip...";
    submitBtn.disabled = true;

    try {
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            mode: 'no-cors', 
            headers: { 'Content-Type': 'text/plain' }, 
            body: JSON.stringify(payload) 
        });

        document.getElementById('success-overlay').classList.remove('hidden');

        setTimeout(() => {
            localStorage.setItem('danceAppUser', JSON.stringify({ 
                chipID: idFromURL, 
                alias: payload.alias, 
                userKey: userKey,
                role: payload.role
            }));
            location.reload(); // Refresh to initialize the Dashboard state
         }, 1500);
    } catch (error) {
        showError("Registration failed. Please try again.");
        submitBtn.innerText = "Link My Chip";
        submitBtn.disabled = false;
    }
};

document.getElementById('feedbackForm').onsubmit = async (e) => {
    e.preventDefault();
    const user = JSON.parse(localStorage.getItem('danceAppUser'));
    const feedback = {
        action: 'submitFeedback',
        chipID: user.chipID,
        music: document.getElementById('musicRating').value,
        favPartner: document.getElementById('favPartner').value,
        comments: document.getElementById('comments').value
    };

    try {
        await fetch(WEB_APP_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(feedback) });
        localStorage.setItem('statsUnlocked', 'true');
        document.getElementById('feedback-overlay').classList.add('hidden');
        loadDancerView(); 
    } catch (e) { showError("Failed to save feedback."); }
};

/** --- UI HELPERS --- **/

function renderHistoryTable(data) {
    const tbody = document.getElementById('historyBody');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color: #999;">No pending confirmations.</td></tr>';
        return;
    }

    // 1. SORTING: Ensure newest dances are at the top
    const sortedData = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 2. RENDERING: Generate clean HTML
    tbody.innerHTML = sortedData.map(row => {
        const date = new Date(row.timestamp);
        const timeStr = `${date.toLocaleDateString([], {weekday:'short'})} ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        
        const isConfirmed = row.status === 'Confirmed';
        let statusHtml = '';

        if (isConfirmed) {
            statusHtml = `<span class="status-pill status-confirmed">Confirmed</span>`;
        } else if (row.isTarget) {
            // PURPLE PRIMARY BUTTON: Needs my action
            statusHtml = `<button class="status-pill" onclick="confirmDanceManually('${row.rowId}')">Confirm?</button>`;
        } else {
            // GRAY BORDER: Waiting for the other person
            statusHtml = `<span class="status-pill status-waiting">Waiting</span>`;
        }

        return `<tr>
            <td><strong>${row.partnerAlias}</strong></td>
            <td><small style="color: #888;">${timeStr}</small></td>
            <td style="text-align: right;">${statusHtml}</td>
        </tr>`;
    }).join('');
}

// Pending' now only shows what YOU need to confirm
function filterHistory(type) {
    // Update button visuals
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`filter-${type.toLowerCase()}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (type === 'all') {
        renderHistoryTable(fullHistoryData);
    } else if (type === 'Pending') {
        // Only show dances I haven't confirmed yet (I am the target of the scan)
        const toConfirm = fullHistoryData.filter(item => item.status === 'Pending' && item.isTarget === true);
        renderHistoryTable(toConfirm);
    }
}

// function showView(viewId) {
//     document.querySelectorAll('.card, #registration-view, #dancer-view, #scan-view').forEach(v => v.classList.add('hidden'));
//     document.getElementById(viewId).classList.remove('hidden');
// }

function showView(viewId) {
    // 1. Hide the three main high-level containers
    const views = ['scan-view', 'registration-view', 'dancer-view', 'organizer-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // 2. Show the requested one
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');
    }
}

window.selectRole = function(roleValue) {
    const roleInput = document.getElementById('role');
    if (roleInput) roleInput.value = roleValue;

    document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = roleValue === 'Leader' ? document.getElementById('btn-leader') : document.getElementById('btn-follower');
    if (activeBtn) activeBtn.classList.add('active');

    const roleError = document.getElementById('role-error');
    if (roleError) roleError.style.display = 'none';

    validateFormState();
};

function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;

    const roleValue = document.getElementById('role').value;
    const hasUniquenessErrors = form.querySelector('.is-invalid');
    const isFormValid = form.checkValidity();

    if (isFormValid && roleValue && !hasUniquenessErrors) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('btn-locked');
    } else {
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-locked');
    }
}

async function checkUniqueness(field, value) {
    if (!value) return false; 
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=checkUnique&field=${field}&value=${encodeURIComponent(value)}`);
        const result = await resp.json();
        return result.exists;
    } catch (e) { return false; }
}

document.getElementById('alias').addEventListener('blur', async (e) => {
    const input = e.target;
    if (!input.value.trim()) return;
    const isTaken = await checkUniqueness('alias', input.value.trim());
    const errorSpan = input.nextElementSibling;
    if (isTaken) {
        input.classList.add('is-invalid');
        if (errorSpan) errorSpan.innerText = "This Alias is already taken.";
    } else {
        input.classList.remove('is-invalid');
        if (errorSpan) errorSpan.innerText = "Alias cannot contain spaces";
    }
    validateFormState();
});

document.getElementById('email').addEventListener('blur', async (e) => {
    const input = e.target;
    if (!input.value.trim()) return;
    const isTaken = await checkUniqueness('email', input.value.trim());
    const errorSpan = input.nextElementSibling;
    if (isTaken) {
        input.classList.add('is-invalid');
        if (errorSpan) errorSpan.innerText = "This email is already registered.";
    } else {
        input.classList.remove('is-invalid');
        if (errorSpan) errorSpan.innerText = "Please enter a valid email address";
    }
    validateFormState();
});

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
        input.classList.remove('is-invalid');
        validateFormState();
    });
});

function showError(msg) {
    const errorOverlay = document.getElementById('error-overlay');
    const errorMsgText = document.getElementById('error-message');
    if (errorMsgText) errorMsgText.innerText = msg;
    if (errorOverlay) errorOverlay.classList.remove('hidden');
}

window.hideErrorOverlay = function() {
    document.getElementById('error-overlay').classList.add('hidden');
};

function showFeedbackForm() { document.getElementById('feedback-overlay').classList.remove('hidden'); }
function hideFeedback() { document.getElementById('feedback-overlay').classList.add('hidden'); }

window.unlinkChip = function() {
    if(confirm("Unlink this chip from this phone?")) {
        localStorage.removeItem('danceAppUser');
        location.reload();
    }
};