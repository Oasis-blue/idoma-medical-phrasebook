// Supabase Public Configuration Constants
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project settings from supabase.com

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

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