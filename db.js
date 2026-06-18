/**
 * db.js - Supabase Database Layer for Dance Tracker
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ksgdxvbwwgktcpzoxbba.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzZ2R4dmJ3d2drdGNwem94YmJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDM1ODEsImV4cCI6MjA5NzMxOTU4MX0.PQoBQa0ncMM933iOQd7F7Jf6-9iqMzbkhBLFp5I9eoI'
export const supabase = createClient(supabaseUrl, supabaseKey)

// --- USER FUNCTIONS ---

export async function checkUser(chip_id) {
    // 1. Check if user exists
    const { data: user, error: userErr } = await supabase
        .from('users')
        .select('*')
        .eq('chip_id', chip_id)
        .single();

    if (!user) return { registered: false };

    // 2. Check if they have given feedback
    const { count } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('chip_id', chip_id);

    return {
        registered: true,
        alias: user.alias,
        role: user.role,
        country: user.country,
        user_key: user.user_key,
        feedbackGiven: count > 0
    };
}

export async function registerUser(userData) {
    const { error } = await supabase.from('users').insert([userData]);
    if (error) throw error;
    return true;
}

// --- INTERACTION / DANCE LOGIC ---

export async function logDance(scanner_id, target_id) {
    const now = new Date();
    const sessionId = now.toISOString().split('T')[0];
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

    // 1. Check if target is registered
    const { data: targetExists } = await supabase
        .from('users')
        .select('chip_id, alias, confession')
        .eq('chip_id', target_id)
        .single();

    if (!targetExists) return { success: false, status: "Unregistered" };

    const partnerAlias = targetData.alias;
    const confession = targetData.confession || "";

    // 2. Fetch recent interactions (Last 10 mins between these two users)
    const { data: recentLogs } = await supabase
        .from('interactions')
        .select('*')
        .gte('timestamp', tenMinsAgo)
        .or(`and(scanner_id.eq.${scanner_id},target_id.eq.${target_id}),and(scanner_id.eq.${target_id},target_id.eq.${scanner_id})`)
        .eq('status', 'Pending');

    if (recentLogs && recentLogs.length > 0) {
        const log = recentLogs[0];
        
        // The Handshake: Target scanned me recently, so confirm it.
        if (log.scanner_id === target_id) {
            await supabase.from('interactions').update({ status: 'Confirmed' }).eq('id', log.id);
            return { success: true, status: "Confirmed", partnerAlias, confession };
        }
        
        // The Duplicate: I already scanned them, update timestamp to reset cooldown.
        if (log.scanner_id === scanner_id) {
            await supabase.from('interactions').update({ timestamp: now.toISOString() }).eq('id', log.id);
            return { success: true, status: "Pending", message: "Duplicate", partnerAlias, confession };
        }
    }

    // 3. New Dance Log
    await supabase.from('interactions').insert([{
        timestamp: now.toISOString(),
        scanner_id,
        target_id,
        status: 'Pending',
        session_id: sessionId
    }]);

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

    if (error || !data) return [];

    return data.map(row => {
        const isTarget = row.target_id === my_id;
        const partner = isTarget ? row.scanner : row.target;
        return {
            rowId: row.id, // Using the postgres serial ID
            timestamp: row.timestamp,
            partnerAlias: partner?.alias || "Unknown",
            partnerCountry: partner?.country || "",
            status: row.status,
            isTarget: isTarget
        };
    });
}

export async function updateDanceStatus(rowId, status) {
    const { error } = await supabase.from('interactions').update({ status }).eq('id', rowId);
    if (error) throw error;
    return true;
}

// --- FEEDBACK FUNCTIONS ---

export async function getFeedbackTemplate() {
    const { data } = await supabase.from('feedback_config').select('*').order('id');
    return data || [];
}

export async function submitFeedback(chip_id, feedbackData) {
    // Supabase 'upsert' handles the "Update if exists, Insert if new" logic automatically
    // as long as chip_id is set as a UNIQUE constraint or Primary Key in your feedback table.
    const payload = { timestamp: new Date().toISOString(), chip_id, ...feedbackData };
    const { error } = await supabase.from('feedback').upsert(payload, { onConflict: 'chip_id' });
    if (error) throw error;
    return true;
}