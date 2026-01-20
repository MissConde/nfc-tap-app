// app.js

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwblf_uDWQ8bPh58KW09GD9ksZqeMrjtLBAb7a8sU7ArX_6v1SUMnF4MCz7z1-r4IU2/exec"
const urlParams = new URLSearchParams(window.location.search);
const chipIDFromURL = urlParams.get('id');

window.onload = async () => {
    const savedUser = JSON.parse(localStorage.getItem('danceAppUser'));

    if (savedUser && savedUser.chipID) {
        showView('dancer-view');
        loadLeaderboard();
    } else if (chipIDFromURL) {
        checkUserInSystem(chipIDFromURL);
    } else {
        document.getElementById('scan-status').innerText = "Please tap your NFC chip to begin.";
    }
    // Initialize button state on load
    validateFormState();
};

/**
 * UI & VALIDATION LOGIC
 */

// Function to enable/disable the submit button visually and functionally
function validateFormState() {
    const form = document.getElementById('regForm');
    const submitBtn = document.getElementById('submitBtn');
    if (!form || !submitBtn) return;

    const roleValue = document.getElementById('role').value;
    const hasUniquenessErrors = form.querySelector('.is-invalid');
    
    // checkValidity() verifies all 'required', 'pattern', and 'type="email"' fields
    const isFormValid = form.checkValidity();

    if (isFormValid && roleValue && !hasUniquenessErrors) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('btn-locked');
    } else {
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-locked');
    }
}

window.selectRole = function(roleValue) {
    const roleInput = document.getElementById('role');
    if (roleInput) roleInput.value = roleValue;

    const leaderBtn = document.getElementById('btn-leader');
    const followerBtn = document.getElementById('btn-follower');

    if (leaderBtn) leaderBtn.classList.remove('active');
    if (followerBtn) followerBtn.classList.remove('active');

    if (roleValue === 'Leader' && leaderBtn) {
        leaderBtn.classList.add('active');
    } else if (roleValue === 'Follower' && followerBtn) {
        followerBtn.classList.add('active');
    }

    const roleError = document.getElementById('role-error');
    if (roleError) roleError.style.display = 'none';

    // Re-check form whenever role changes
    validateFormState();
};

// --- UNIQUENESS LOGIC ---

async function checkUniqueness(field, value) {
    if (!value) return false; 
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=checkUnique&field=${field}&value=${encodeURIComponent(value)}`);
        const result = await resp.json();
        return result.exists;
    } catch (e) {
        console.error("Check failed", e);
        return false; 
    }
}

// Logic for Alias validation
document.getElementById('alias').addEventListener('blur', async (e) => {
    const input = e.target;
    if (input.value.trim() === "") return;

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

// Logic for Email validation
document.getElementById('email').addEventListener('blur', async (e) => {
    const input = e.target;
    if (input.value.trim() === "") return;

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

// Listen to all inputs to clear errors and update button state
document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
        input.classList.remove('is-invalid');
        validateFormState();
    });
});

/**
 * DATA SUBMISSION & SYSTEM CHECKS
 */

async function checkUserInSystem(id) {
    const resp = await fetch(`${WEB_APP_URL}?action=check&id=${id}`);
    const result = await resp.json();

    if (result.registered) {
        const userData = { chipID: id, alias: result.alias, userKey: result.storedKey };
        localStorage.setItem('danceAppUser', JSON.stringify(userData));
        showView('dancer-view');
    } else {
        showView('registration-view');
    }
}

document.getElementById('regForm').onsubmit = async (e) => {
    e.preventDefault();

    const form = e.target;
    const roleValue = document.getElementById('role').value;

    // Safety check (though button should be disabled anyway)
    if (!form.checkValidity() || !roleValue || form.querySelector('.is-invalid')) {
        form.classList.add('was-validated'); 
        return; 
    }

    const userKey = Math.random().toString(36).substring(2, 8).toUpperCase();
    let igHandle = document.getElementById('igUser').value.trim();
    if (igHandle.startsWith('@')) igHandle = igHandle.substring(1);

    const payload = {
        action: "register",
        chipID: chipIDFromURL,
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

        setTimeout(() => {
            localStorage.setItem('danceAppUser', JSON.stringify({ 
                chipID: chipIDFromURL, 
                alias: payload.alias, 
                userKey: userKey,
                role: payload.role
            }));

            alert("Registration Successful! Your chip is now linked.");
            showView('dancer-view');

            document.getElementById('displayName').innerText = payload.alias;
            document.getElementById('displayRole').innerText = payload.role;
         }, 1200);
        
    } catch (error) {
        console.error("Network error:", error);
        alert("Check your internet connection and try again.");
        submitBtn.innerText = "Try Again";
        submitBtn.disabled = false;
        validateFormState();
    }
};

function showView(viewId) {
    document.querySelectorAll('.card, #registration-view, #dancer-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}