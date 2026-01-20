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

function selectRole(roleValue) {
    // 1. Update the hidden input value
    document.getElementById('role').value = roleValue;

    // 2. Clear 'active' class from all role buttons
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // 3. Add 'active' class to the clicked button
    // We find the button based on its text or a specific ID
    const selectedBtn = roleValue === 'Leader' ? document.getElementById('btn-leader') : document.getElementById('btn-follower');
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
}

// Function to check uniqueness
async function checkUniqueness(field, value) {
    try {
        const resp = await fetch(`${WEB_APP_URL}?action=checkUnique&field=${field}&value=${encodeURIComponent(value)}`);
        const result = await resp.json();
        return result.exists;
    } catch (e) {
        console.error("Check failed", e);
        return false; 
    }
}

// Attach listeners to input fields
document.getElementById('alias').addEventListener('blur', async (e) => {
    const isTaken = await checkUniqueness('alias', e.target.value);
    if (isTaken) {
        alert("This Alias is already taken! Please choose another.");
        e.target.value = ""; // Clear it
    }
});

document.getElementById('email').addEventListener('blur', async (e) => {
    const isTaken = await checkUniqueness('email', e.target.value);
    if (isTaken) {
        alert("This email is already registered.");
        e.target.value = "";
    }
});

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
    const roleValue = document.getElementById('role').value;
    const roleError = document.getElementById('role-error');

    // 1. FINAL VALIDATION GUARD
    // checkValidity() checks all the 'pattern' and 'required' rules in your HTML
    if (!form.checkValidity() || !roleValue) {
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
    const originalText = submitBtn.innerText;
    submitBtn.innerText = "Registering...";
    submitBtn.disabled = true;

    try {
        // 4. SEND TO GOOGLE
        await fetch(WEB_APP_URL, { 
            method: 'POST', 
            mode: 'no-cors', // Added to prevent CORS errors with Google Script
            body: JSON.stringify(payload) 
        });

        // 5. SAVE SESSION & REDIRECT
        localStorage.setItem('danceAppUser', JSON.stringify({ 
            chipID: chipIDFromURL, 
            alias: payload.alias, 
            userKey: userKey,
            role: payload.role // Store role for the Profile view later
        }));

        showView('dancer-view');
        if (typeof loadLeaderboard === "function") loadLeaderboard();
        
    } catch (error) {
        console.error("Upload error:", error);
        alert("Connection error. Please check your internet and try again.");
        submitBtn.innerText = originalText;
        submitBtn.disabled = false;
    }
};

function showView(viewId) {
    document.querySelectorAll('.card, #registration-view, #dancer-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}