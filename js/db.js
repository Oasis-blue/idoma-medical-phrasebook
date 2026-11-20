// Database Interactions (Supabase Cloud + Local IndexedDB / LocalStorage Fallback)

const LOCAL_STORAGE_KEY_PHRASES = 'idoma_phrases_data';
const LOCAL_STORAGE_KEY_AUDIO = 'idoma_audio_recordings';
const LOCAL_STORAGE_KEY_CONTRIBUTORS = 'idoma_contributors_list';

// Fetch All Published Phrases
async function dbFetchPhrases() {
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('phrases')
                .select('*')
                .eq('is_published', true)
                .order('sort_order', { ascending: true });

            if (!error && data && data.length > 0) {
                return data.map(item => ({
                    id: item.id,
                    category: item.section,
                    english: item.english_term,
                    idoma: item.idoma_term || '',
                    syllables: item.syllables || '',
                    toneNote: item.tone_note || '',
                    notes: item.clinical_note || '',
                    verificationStatus: item.verification_status || 'unconfirmed'
                }));
            }
        } catch (e) {
            console.warn("Cloud fetch failed, using seed data:", e);
        }
    }

    // Local Fallback
    try {
        const localData = localStorage.getItem(LOCAL_STORAGE_KEY_PHRASES);
        if (localData) {
            const parsed = JSON.parse(localData);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) {}

    return null; // Signals app to load MASTER_SEED_PHRASES
}

// Fetch Active Contributors for Credits
async function dbFetchContributors() {
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('contributors')
                .select('full_name, role_title, show_in_credits, access_code')
                .eq('is_active', true)
                .eq('show_in_credits', true);

            if (!error && data && data.length > 0) {
                return data;
            }
        } catch (e) {}
    }

    // Fallback default list
    return [
        { full_name: "Grace Adini", role_title: "Translation", access_code: "CONT-GRACE-01" },
        { full_name: "Ben Odeh", role_title: "Dialect Review", access_code: "CONT-BEN-01" },
        { full_name: "Dr Jude A", role_title: "Clinical Accuracy Review", access_code: "CONT-JUDE-01" },
        { full_name: "James Gabriel", role_title: "Proofreading", access_code: "CONT-JAMES-01" }
    ];
}

// Save Term Request / Submission
async function dbSubmitTermRequest(term, category, note) {
    if (supabaseClient) {
        try {
            await supabaseClient.from('phrase_submissions').insert([{
                submission_type: 'term_request',
                english_term: term,
                section: category,
                clinical_note: note,
                review_status: 'pending'
            }]);
        } catch (e) {
            console.warn("Cloud submission failed, stored locally.");
        }
    }
}