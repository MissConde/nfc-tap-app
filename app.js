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
};

window.selectRole = function(roleValue) {
    // 1. Update the hidden input value
    const roleInput = document.getElementById('role');
    if (roleInput) roleInput.value = roleValue;

    // 2. Visual feedback
    const leaderBtn = document.getElementById('btn-leader');
    const followerBtn = document.getElementById('btn-follower');

    if (leaderBtn) leaderBtn.classList.remove('active');
    if (followerBtn) followerBtn.classList.remove('active');

    if (roleValue === 'Leader' && leaderBtn) {
        leaderBtn.classList.add('active');
    } else if (roleValue === 'Follower' && followerBtn) {
        followerBtn.classList.add('active');
    }

    // Hide error message if it was showing
    const roleError = document.getElementById('role-error');
    if (roleError) roleError.style.display = 'none';

    console.log("Role selected and locked:", roleValue);
};

// Function to check uniqueness
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
    const errorSpan = input.nextElementSibling; // Targets the <span class="error-msg"> right after the input

    if (isTaken) {
        input.classList.add('is-invalid');
        if (errorSpan) errorSpan.innerText = "This Alias is already taken.";
    } else {
        input.classList.remove('is-invalid');
        if (errorSpan) errorSpan.innerText = "Alias cannot contain spaces";
    }
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
});

// Clear the error status when they start typing
document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
        input.classList.remove('is-invalid');
    });
});

// --- REGISTRATION PROCESS ---

async function checkUserInSystem(id) {
    const resp = await fetch(`${WEB_APP_URL}?action=check&id=${id}`);
    const result = await resp.json();

    if (result.registered) {
        // Recovery Logic: For this MVP, we auto-restore. 
        // In the future, add an email check here.
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
    const hasExistingErrors = form.querySelector('.is-invalid');
    const roleValue = document.getElementById('role').value;
    const roleError = document.getElementById('role-error');

    // 1. FINAL VALIDATION GUARD
    // checkValidity() checks all the 'pattern' and 'required' rules in your HTML
    if (!form.checkValidity() || !roleValue || hasExistingErrors) {
        if (!roleValue) roleError.style.display = 'block';
        form.classList.add('was-validated'); // Optional: helps style error colors
        return; 
    }

    roleError.style.display = 'none';

    // 2. DATA PREPARATION
    const userKey = Math.random().toString(36).substring(2, 8).toUpperCase();
    let igHandle = document.getElementById('igUser').value.trim();

    // Auto-remove '@' if user typed it (keeps your Google Sheet clean)
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

    // 3. UI FEEDBACK (Disable button during network request)
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerText = "Linking Chip...";
    submitBtn.disabled = true;

    try {
        // 4. SEND TO GOOGLE
        // We use 'no-cors' to ensure the request actually fires without being blocked
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            mode: 'no-cors', // Added to prevent CORS errors with Google Script
            headers: { 'Content-Type': 'text/plain' }, // Use text/plain to avoid preflight
            body: JSON.stringify(payload) 
        });

        // 5. SAVE SESSION & REDIRECT
        // Since we can't read the response, we wait 1 second to ensure 
        // the browser finished the send-off before moving the UI.
        setTimeout(() => {
            localStorage.setItem('danceAppUser', JSON.stringify({ 
                chipID: chipIDFromURL, 
                alias: payload.alias, 
                userKey: userKey,
                role: payload.role // Store role for the Profile view later
            }));

            // Success feedback
            alert("Registration Successful! Your chip is now linked.");
            showView('dancer-view');

            // Update the UI with the new data
            document.getElementById('displayName').innerText = payload.alias;
            document.getElementById('displayRole').innerText = payload.role;
         }, 1200);
        
    } catch (error) {
        console.error("Network error:", error);
        alert("Check your internet connection and try again.");
        submitBtn.innerText = "Try Again";
        submitBtn.disabled = false;
    }
};

function showView(viewId) {
    document.querySelectorAll('.card, #registration-view, #dancer-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}