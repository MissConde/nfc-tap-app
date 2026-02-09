const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby5wet3I48Q1zmUxWo5eHFAycw6wbwGYggHuk3_2IRMaBM1q2ePr78ayQxdVCwjM7p1/exec"; // Replace with actual URL if different

// --- ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    // Show login overlay immediately
    document.getElementById('admin-login-overlay').classList.remove('hidden');
    document.getElementById('admin-pin-input').focus();
});

// --- ADMIN LOGIN ---
window.submitAdminPin = function () {
    const input = document.getElementById('admin-pin-input');
    const pin = input.value;

    if (!pin) return;

    // Simple Jenkins-like hash for client-side obfuscation
    const hashCode = s => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);

    // Hash for "2026" is 1537282
    if (hashCode(pin) === 1537282) {
        document.getElementById('admin-login-overlay').classList.add('hidden');
        showStatus('success', 'Access Granted', 'Welcome to Admin Mode');

        // Show Organizer View
        const view = document.getElementById('organizer-view');
        view.classList.remove('hidden');
        view.classList.add('fade-in');

        // Fetch Data
        fetchAdminStats();
    } else {
        document.getElementById('admin-login-error').style.display = 'block';
        input.value = '';
        input.focus();
    }
};

// --- DATA FETCHING ---
window.fetchAdminStats = async function () {
    const loadingOverlay = document.getElementById('admin-loading-overlay');

    try {
        if (loadingOverlay) loadingOverlay.classList.remove('hidden'); // Show Loading

        const resp = await fetch(`${WEB_APP_URL}?action=getAdminStats`);
        const data = await resp.json();
        console.log("Admin Stats Data:", data);

        // 1. Registered Users
        const elTotal = document.getElementById('pulse-count');
        if (elTotal) elTotal.innerText = data.totalDancers || 0;

        // 2. Role Balance
        const leadPct = data.percentLeaders || 0;
        const followPct = 100 - leadPct;

        const elBar = document.getElementById('balance-bar');
        const elLeadPct = document.getElementById('role-lead-pct');
        const elFollowPct = document.getElementById('role-follow-pct');

        if (elBar) elBar.style.width = `${leadPct}%`;
        if (elLeadPct) elLeadPct.innerText = `${leadPct}%`;
        if (elFollowPct) elFollowPct.innerText = `${followPct}%`;

        // 2b. Vibe Score
        const fbScore = document.getElementById('feedback-vibe-score');
        if (fbScore) fbScore.innerText = data.avgVibe || "N/A";

        // 3. Feedback Completed
        const elFeedback = document.getElementById('feedback-completed-count');
        if (elFeedback) elFeedback.innerText = data.feedbackCount || 0;

        // 4. Live Feed
        const elFeedList = document.getElementById('live-feed-list');
        if (elFeedList) {
            if (!data.recentDances || data.recentDances.length === 0) {
                elFeedList.innerHTML = '<li style="padding:10px; color:#999; text-align:center;">Quiet on the floor...</li>';
            } else {
                elFeedList.innerHTML = data.recentDances.map(d => `
                    <li style="padding: 10px 0; border-bottom: 1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:500; color:#333;">${d.pair}</span>
                        <span style="font-size:0.8rem; color:#999;">${d.time}</span>
                    </li>
                `).join('');
            }
        }

        // 5. Top Dancers
        const elTopList = document.getElementById('top-dancers-list');
        if (elTopList) {
            if (!data.topDancers || data.topDancers.length === 0) {
                elTopList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color:#999;">No data yet</td></tr>';
            } else {
                elTopList.innerHTML = data.topDancers.map((d, i) => `
                    <tr style="border-bottom:1px solid #f0f0f0;">
                        <td style="padding:8px 0; font-weight:500;">
                            ${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''} ${d.alias}
                        </td>
                        <td style="padding:8px 0; font-size:0.85rem; color:#666;">${d.role}</td>
                        <td style="padding:8px 0; text-align:right; font-weight:bold; color:var(--primary);">${d.count}</td>
                    </tr>
                `).join('');
            }
        }

    } catch (e) {
        console.error("Failed to load admin stats", e);
        showStatus('error', 'Error', 'Failed to load dashboard data');
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden'); // Hide Loading
    }
};

// --- NAVIGATION ---
window.toggleAdminAccordion = function (tabName) {
    const content = document.getElementById('tab-' + tabName);
    const headers = document.querySelectorAll('.accordion-header');
    let targetHeader;
    if (tabName === 'pulse') targetHeader = headers[0];
    if (tabName === 'feedback') targetHeader = headers[1];
    if (tabName === 'tools') targetHeader = headers[2];

    const isHidden = content.classList.contains('hidden');

    // Close all
    document.querySelectorAll('.admin-tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('active');
    });
    document.querySelectorAll('.accordion-header').forEach(el => el.classList.remove('active'));

    if (isHidden) {
        content.classList.remove('hidden');
        content.classList.add('active');
        if (targetHeader) targetHeader.classList.add('active');
    }
};

window.switchAdminTab = function (tabName) {
    document.querySelectorAll('.admin-tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('active');
    });

    const target = document.getElementById('tab-' + tabName);
    target.classList.remove('hidden');
    target.classList.add('active');

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    // Simple active button logic
    const buttons = document.querySelectorAll('.tab-btn');
    if (tabName === 'pulse') buttons[0].classList.add('active');
    if (tabName === 'feedback') buttons[1].classList.add('active');
    if (tabName === 'tools') buttons[2].classList.add('active');
};

// --- TOOLS ---
window.adminSearchDancer = async function () {
    const input = document.getElementById('admin-search-input');
    const resultBox = document.getElementById('admin-search-result');
    const query = input.value.trim();

    if (!query) return;

    resultBox.innerHTML = '<span style="color:#666;">Searching...</span>';
    resultBox.classList.remove('hidden');

    try {
        const resp = await fetch(`${WEB_APP_URL}?action=adminSearch&query=${encodeURIComponent(query)}`);
        const data = await resp.json();

        if (data.found) {
            resultBox.innerHTML = `
                <div style="font-weight:bold; color:var(--primary);">${data.realName}</div>
                <div style="font-size:0.9rem; color:#444; margin-top:2px;">Role: ${data.role}</div>
                <div style="font-size:0.8rem; color:#666; margin-top:5px;">Email: <a href="mailto:${data.email}">${data.email}</a></div>
                <div style="font-size:0.8rem; color:#666;">Chip: ${data.chipId}</div>
            `;
        } else {
            resultBox.innerHTML = '<span style="color:var(--error);">Dancer not found.</span>';
        }
    } catch (e) {
        resultBox.innerHTML = '<span style="color:var(--error);">Search failed.</span>';
    }
};

// --- UTILS ---
function showStatus(type, title, msg) {
    const overlay = document.getElementById('master-overlay');
    const icons = {
        success: document.getElementById('icon-success'),
        error: document.getElementById('icon-error'),
        loading: document.getElementById('icon-loading')
    };

    Object.values(icons).forEach(el => { if (el) el.classList.add('hidden') });
    if (icons[type]) icons[type].classList.remove('hidden');

    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-msg').innerText = msg;
    overlay.classList.remove('hidden');

    if (type !== 'loading') {
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 2000);
    }
}
