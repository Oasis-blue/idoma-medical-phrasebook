// Supabase Public Configuration Constants
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project settings from supabase.com

const SUPABASE_URL = "https://tqsfsvlsztilrsmbkbnz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_GkHan_5apqHG3dP9g7_VSg_Ow5GWnBU";

// Safe Supabase Client Initializer
let supabaseClient = null;

if (typeof supabase !== 'undefined' && SUPABASE_URL !== "YOUR_SUPABASE_PROJECT_URL") {
    try {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase Client initialized successfully.");
    } catch (e) {
        console.warn("Supabase init error, running in Local/Offline Mode:", e);
    }
} else {
    console.log("Running in Local/IndexedDB Fallback Mode (Supabase URL unconfigured).");
}