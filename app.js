// app.js

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxDdmdM11N8B05RHbDhNLuFiBJvcnQTBAxRhZKmKNo3kpyOw5fJsoHxHwd7JBkbh7I/exec"
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
    const userKey = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const payload = {
        action: "register",
        chipID: chipIDFromURL,
        userKey: userKey,
        alias: document.getElementById('alias').value,
        fullName: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
        role: document.getElementById('role').value,
        igUser: document.getElementById('igUser').value,
        consent: document.getElementById('consent').checked
    };

    await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('danceAppUser', JSON.stringify({ chipID: chipIDFromURL, alias: payload.alias, userKey: userKey }));
    showView('dancer-view');
};

function showView(viewId) {
    document.querySelectorAll('.card, #registration-view, #dancer-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}