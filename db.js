/**
 * db.js - Supabase Database Layer for Dance Tracker
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ksgdxvbwwgktcpzoxbba.supabase.co'
const supabaseKey = 'sb_publishable_dVwp9LRmcJSmaBnAijuu5A_I1twLkMT'
export const supabase = createClient(supabaseUrl, supabaseKey)

// --- Anonymous Authentication ---
export async function initializeDatabaseConnection() {
    const { data } = await supabase.auth.getSession();

    // If there is no active session, sign in silently as an anonymous user
    if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) {
            console.error("Could not establish anonymous connection:", error);
        }
    }
}

// --- USER FUNCTIONS ---

export async function checkUser(chip_id) {
    // 1. Check if user exists
    const { data: user, error: userErr } = await supabase
        .from('users')
        .select('*')
        .eq('chip_id', chip_id)
        .maybeSingle();

    // A real query/network error must surface as an error, NOT as "not registered"
    if (userErr) throw userErr;
    if (!user) return { registered: false };

    // 2. Check if they have given feedback
    const { count, error: fbErr } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('chip_id', chip_id);

    if (fbErr) console.warn("Could not check feedback status:", fbErr);

    return {
        registered: true,
        alias: user.alias,
        role: user.role,
        country: user.country,
        user_key: user.user_key,
        confession: user.confession || "",
        feedbackGiven: (count || 0) > 0
    };
}

export async function registerUser(userData) {
    const { error } = await supabase.from('users').insert([userData]);
    if (error) throw error;
    return true;
}

export async function getConfession(chip_id) {
    const { data, error } = await supabase
        .from('users')
        .select('confession')
        .eq('chip_id', chip_id)
        .maybeSingle();
    if (error) throw error;
    return data ? (data.confession || "") : "";
}

export async function updateConfession(chip_id, confession) {
    const { error } = await supabase
        .from('users')
        .update({ confession })
        .eq('chip_id', chip_id);
    if (error) throw error;
    return true;
}

// --- INTERACTION / DANCE LOGIC ---

export async function logDance(scanner_id, target_id) {
    const now = new Date();
    const sessionId = now.toISOString().split('T')[0];
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

    // 1. Check if target is registered
    const { data: targetData, error: targetErr } = await supabase
        .from('users')
        .select('chip_id, alias, confession')
        .eq('chip_id', target_id)
        .maybeSingle();

    if (targetErr) throw targetErr;
    if (!targetData) return { success: false, status: "Unregistered" };

    const partnerAlias = targetData.alias;
    const confession = targetData.confession || "";

    // 2. Fetch recent PENDING interactions between these two users (last 10 mins)
    const { data: recentLogs, error: logsErr } = await supabase
        .from('interactions')
        .select('*')
        .gte('timestamp', tenMinsAgo)
        .or(`and(scanner_id.eq.${scanner_id},target_id.eq.${target_id}),and(scanner_id.eq.${target_id},target_id.eq.${scanner_id})`)
        .eq('status', 'Pending');

    if (logsErr) throw logsErr;

    if (recentLogs && recentLogs.length > 0) {
        const log = recentLogs[0];

        // The Handshake: Target scanned me recently, so confirm it.
        if (log.scanner_id === target_id) {
            const { error } = await supabase
                .from('interactions')
                .update({ status: 'Confirmed' })
                .eq('id', log.id);
            if (error) throw error;
            return { success: true, status: "Confirmed", partnerAlias, confession };
        }

        // The Duplicate: I already scanned them, refresh the timestamp (reset cooldown).
        if (log.scanner_id === scanner_id) {
            const { error } = await supabase
                .from('interactions')
                .update({ timestamp: now.toISOString() })
                .eq('id', log.id);
            if (error) throw error;
            return { success: true, status: "Pending", message: "Duplicate", partnerAlias, confession };
        }
    }

    // 3. New Dance Log
    // NOTE: this INSERT is the call that fails with "permission denied for
    // sequence interactions_id_seq" if sequence grants are missing.
    const { error: insertErr } = await supabase.from('interactions').insert([{
        timestamp: now.toISOString(),
        scanner_id,
        target_id,
        status: 'Pending',
        session_id: sessionId
    }]);
    if (insertErr) throw insertErr;

    return { success: true, status: "Pending", partnerAlias, confession };
}

export async function getHistory(my_id) {
    // Fetch interactions and join with users table to get partner names
    const { data, error } = await supabase
        .from('interactions')
        .select(`
            id, timestamp, status, scanner_id, target_id,
            scanner:users!scanner_id(alias, country),
            target:users!target_id(alias, country)
        `)
        .or(`scanner_id.eq.${my_id},target_id.eq.${my_id}`)
        .neq('status', 'Cancelled')
        .order('timestamp', { ascending: false });

    if (error) throw error;
    if (!data) return [];

    return data.map(row => {
        const isTarget = row.target_id === my_id;
        const partner = isTarget ? row.scanner : row.target;
        return {
            rowId: row.id, // Postgres serial ID
            timestamp: row.timestamp,
            partnerAlias: partner?.alias || "Unknown",
            partnerCountry: partner?.country || "",
            status: row.status,
            isTarget: isTarget
        };
    });
}

export async function confirmDance(rowId) {
    const { data, error } = await supabase
        .from('interactions')
        .update({ status: 'Confirmed' })
        .eq('id', rowId)
        .eq('status', 'Pending')     // only confirm if still pending
        .select('id');
    if (error) throw error;
    if (data && data.length > 0) return { success: true };

    // Nothing updated → find out why
    const { data: row } = await supabase
        .from('interactions').select('status').eq('id', rowId).maybeSingle();
    return { success: false, currentStatus: row ? row.status : 'Deleted' };
}

export async function cancelDance(rowId) {
    const { data, error } = await supabase
        .from('interactions')
        .update({ status: 'Cancelled' })
        .eq('id', rowId)
        .eq('status', 'Pending')     // only cancel if still pending
        .select('id');
    if (error) throw error;
    if (data && data.length > 0) return { success: true };

    // Nothing updated → find out why
    const { data: row } = await supabase
        .from('interactions').select('status').eq('id', rowId).maybeSingle();
    return { success: false, currentStatus: row ? row.status : 'Deleted' };
}

// --- FEEDBACK FUNCTIONS ---

export async function getFeedbackTemplate() {
    const { data, error } = await supabase
        .from('feedback_config')
        .select('*')
        .order('id');
    if (error) throw error;
    return data || [];
}

export async function submitFeedback(chip_id, feedbackData) {
    // Upsert = "update if exists, insert if new". Requires the UNIQUE
    // constraint on feedback.chip_id (you already have unique_chip_id).
    const payload = { timestamp: new Date().toISOString(), chip_id, ...feedbackData };
    const { error } = await supabase
        .from('feedback')
        .upsert(payload, { onConflict: 'chip_id' });
    if (error) throw error;
    return true;
}

export async function getUserFeedback(chip_id) {
    const { data, error } = await supabase
        .from('feedback')
        .select('*')
        .eq('chip_id', chip_id)
        .maybeSingle(); // they might not have given feedback yet

    if (error) {
        console.error("Error fetching user feedback:", error);
        return null;
    }
    return data;
}
