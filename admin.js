/**
 * admin.js - Organizer Dashboard (Supabase Edition)
 *
 * NOTE: this file must be loaded as <script type="module" src="admin.js">.
 */
import { supabase, initializeDatabaseConnection } from './db.js';

const LOG_LIMIT = 2000; // Same safeguard as the old Apps Script version

// --- ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    // Show login overlay immediately
    document.getElementById('admin-login-overlay').classList.remove('hidden');
    const input = document.getElementById('admin-pin-input');
    input.focus();

    // Allow Enter key to submit the PIN
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') window.submitAdminPin();
    });
});

// --- ADMIN LOGIN ---
// NOTE: This is client-side obfuscation only, not real security. Anyone who
// reads the JS can bypass it. For real per-event admins, use Supabase Auth
// (email login) + RLS policies scoped by event.
window.submitAdminPin = async function () {
    const input = document.getElementById('admin-pin-input');
    const pin = input.value;

    if (!pin) return;

    const hashCode = s => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);

    // Hash for "2026" is 1537282
    if (hashCode(pin) === 1537282) {
        document.getElementById('admin-login-overlay').classList.add('hidden');
        showStatus('success', 'Access Granted', 'Welcome to Admin Mode');

        const view = document.getElementById('organizer-view');
        view.classList.remove('hidden');
        view.classList.add('fade-in');

        // Establish the anonymous Supabase session, then fetch data
        await initializeDatabaseConnection();
        fetchAdminStats();
    } else {
        document.getElementById('admin-login-error').style.display = 'block';
        input.value = '';
        input.focus();
    }
};

// --- HELPERS ---

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- DATA FETCHING ---
window.fetchAdminStats = async function () {
    const loadingOverlay = document.getElementById('admin-loading-overlay');

    try {
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');

        // Fetch everything in parallel. feedback_config drives the actual
        // column names on `feedback` (see db.js submitFeedback), so we select
        // '*' here and resolve the scale-type question id(s) below instead of
        // hardcoding a column name that could drift or not exist — a bad
        // guess there would otherwise throw and take down the whole dashboard.
        const [usersRes, feedbackRes, configRes, interRes] = await Promise.all([
            supabase.from('users').select('chip_id, alias, role, country'),
            supabase.from('feedback').select('*'),
            supabase.from('feedback_config').select('id, type'),
            supabase.from('interactions')
                .select('timestamp, scanner_id, target_id, status')
                .neq('status', 'Cancelled')
                .order('timestamp', { ascending: false })
                .limit(LOG_LIMIT)
        ]);

        if (usersRes.error) throw usersRes.error;
        if (feedbackRes.error) throw feedbackRes.error;
        if (interRes.error) throw interRes.error;
        // A failed config lookup shouldn't take down the whole dashboard —
        // fall back to scanning for any plausible 1-5 rating instead.
        if (configRes.error) console.warn("Could not load feedback_config:", configRes.error);

        const users = usersRes.data || [];
        const feedback = feedbackRes.data || [];
        const interactions = interRes.data || [];
        const scaleIds = (configRes.data || [])
            .filter(q => q.type === 'scale')
            .map(q => q.id);

        // --- Build lookup maps (was the aliasMap/roleMap in Apps Script) ---
        const aliasMap = {};
        const roleMap = {};
        const uniqueCountries = new Set();
        let leaderCount = 0;

        users.forEach(u => {
            aliasMap[u.chip_id] = u.alias;
            roleMap[u.chip_id] = u.role;
            if (u.country) uniqueCountries.add(u.country);
            if (u.role === 'Leader') leaderCount++;
        });

        const totalDancers = users.length;
        const percentLeaders = totalDancers > 0 ? Math.round((leaderCount / totalDancers) * 100) : 0;

        // --- Feedback: count + average vibe ---
        // Average every "scale" question found in feedback_config. Falls back
        // to scanning each row for any plausible 1-5 rating if the config
        // lookup failed or returned no scale questions, so a schema change
        // never hard-breaks this number the way a hardcoded column name would.
        let vibeSum = 0, vibeCount = 0;
        feedback.forEach(row => {
            const idsToCheck = scaleIds.length > 0
                ? scaleIds
                : Object.keys(row).filter(k => k !== 'chip_id' && k !== 'timestamp' && k !== 'id');

            idsToCheck.forEach(id => {
                const v = parseInt(row[id], 10);
                if (!isNaN(v) && v >= 1 && v <= 5) { vibeSum += v; vibeCount++; }
            });
        });
        const avgVibe = vibeCount > 0 ? (vibeSum / vibeCount).toFixed(1) : "N/A";
        const feedbackCount = feedback.length;

        // --- Interactions: live feed, top dancers, density ---
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const topDancersMap = {};
        const recentDances = [];
        let dancesLastHour = 0;

        interactions.forEach(row => {
            const t = new Date(row.timestamp).getTime();
            if (t > oneHourAgo) dancesLastHour++;

            if (row.status === 'Confirmed') {
                topDancersMap[row.scanner_id] = (topDancersMap[row.scanner_id] || 0) + 1;
                topDancersMap[row.target_id] = (topDancersMap[row.target_id] || 0) + 1;

                if (recentDances.length < 5) {
                    recentDances.push({
                        time: fmtTime(row.timestamp),
                        pair: `${aliasMap[row.scanner_id] || "Unknown"} & ${aliasMap[row.target_id] || "Unknown"}`
                    });
                }
            }
        });

        const topDancers = Object.keys(topDancersMap)
            .map(id => ({
                alias: aliasMap[id] || "Unknown",
                role: roleMap[id] || "-",
                count: topDancersMap[id]
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // --- RENDER (same DOM contract as before) ---

        // 1. Registered Users
        const elTotal = document.getElementById('pulse-count');
        if (elTotal) elTotal.innerText = totalDancers;

        // 2. Role Balance
        const followPct = 100 - percentLeaders;
        const elBar = document.getElementById('balance-bar');
        const elLeadPct = document.getElementById('role-lead-pct');
        const elFollowPct = document.getElementById('role-follow-pct');
        if (elBar) elBar.style.width = `${percentLeaders}%`;
        if (elLeadPct) elLeadPct.innerText = `${percentLeaders}%`;
        if (elFollowPct) elFollowPct.innerText = `${followPct}%`;

        // 2b. Vibe Score
        const fbScore = document.getElementById('feedback-vibe-score');
        if (fbScore) fbScore.innerText = avgVibe;

        // 3. Feedback Completed
        const elFeedback = document.getElementById('feedback-completed-count');
        if (elFeedback) elFeedback.innerText = feedbackCount;

        // 3b. Diverse Countries
        const elCountry = document.getElementById('country-count');
        if (elCountry) elCountry.innerText = uniqueCountries.size;

        // 4. Live Feed
        const elFeedList = document.getElementById('live-feed-list');
        if (elFeedList) {
            if (recentDances.length === 0) {
                elFeedList.innerHTML = '<li style="padding:10px; color:#999; text-align:center;">Quiet on the floor...</li>';
            } else {
                elFeedList.innerHTML = recentDances.map(d => `
                    <li style="padding: 10px 0; border-bottom: 1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:500; color:#333;">${escapeHtml(d.pair)}</span>
                        <span style="font-size:0.8rem; color:#999;">${d.time}</span>
                    </li>
                `).join('');
            }
        }

        // 5. Top Dancers
        const elTopList = document.getElementById('top-dancers-list');
        if (elTopList) {
            if (topDancers.length === 0) {
                elTopList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:15px; color:#999;">No data yet</td></tr>';
            } else {
                elTopList.innerHTML = topDancers.map((d, i) => `
                    <tr style="border-bottom:1px solid #f0f0f0;">
                        <td style="padding:8px 0; font-weight:500;">
                            ${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''} ${escapeHtml(d.alias)}
                        </td>
                        <td style="padding:8px 0; font-size:0.85rem; color:#666;">${escapeHtml(d.role)}</td>
                        <td style="padding:8px 0; text-align:right; font-weight:bold; color:var(--primary);">${d.count}</td>
                    </tr>
                `).join('');
            }
        }

    } catch (e) {
        console.error("Failed to load admin stats", e);
        showStatus('error', 'Error', 'Failed to load dashboard data');
    } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
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
        // Case-insensitive partial match on alias or full name
        const { data, error } = await supabase
            .from('users')
            .select('chip_id, alias, full_name, email, role, country')
            .or(`alias.ilike.%${query}%,full_name.ilike.%${query}%`)
            .limit(5);

        if (error) throw error;

        if (data && data.length > 0) {
            resultBox.innerHTML = data.map(u => `
                <div style="padding:8px 0; border-bottom:1px solid #e0f2fe;">
                    <div style="font-weight:bold; color:var(--primary);">${escapeHtml(u.full_name)} <span style="font-weight:normal; color:#666;">(${escapeHtml(u.alias)})</span></div>
                    <div style="font-size:0.9rem; color:#444; margin-top:2px;">Role: ${escapeHtml(u.role)} · ${escapeHtml(u.country || '')}</div>
                    <div style="font-size:0.8rem; color:#666; margin-top:5px;">Email: <a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a></div>
                    <div style="font-size:0.8rem; color:#666;">Chip: ${escapeHtml(u.chip_id)}</div>
                </div>
            `).join('');
        } else {
            resultBox.innerHTML = '<span style="color:var(--error);">Dancer not found.</span>';
        }
    } catch (e) {
        console.error("Admin search failed:", e);
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
