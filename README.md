# Idoma Medical Phrasebook & Clinical Communication Tool

Clinical history-taking and bedside communication guide for medical students and health workers, grounded in the **Idoma Medical Phrasebook** by **Alex Sunday Okoh** (Federal University of Health Sciences, Otukpo — FUHSO).

## Important Tone & Clinical Disclaimer
Idoma is a tonal language where pitch patterns can change meaning, and written spelling alone cannot capture tone. Treat entries as a clinical communication aid and verify pronunciation and clinical register aloud with native speakers and clinical reviewers—especially entries marked unconfirmed or missing.

## Repository Structure
- `index.html` — Main app shell, tabs, Listen Mode response cards, submission/audio forms, and Admin view
- `css/styles.css` — Layout and high-contrast Bedside Mode styles
- `js/config.js` — Supabase project URL and `anon` public key
- `js/db.js` — Database/RPC client with automatic local/seed fallback so the app works immediately even before Supabase keys are entered
- `js/audio-matcher.js` — Microphone recording and candidate best-match comparison for Listen Mode
- `js/app.js` — Phrase Finder, search/filters, Practice Mode, credits, moderation UI, and Admin controls
- `data/seed-phrases.json` — Structured starter entries from the phrasebook draft (including syllables, phonetic hints, tone notes, and verification statuses)
- `supabase/schema.sql` — PostgreSQL tables, `idoma-audio` storage bucket, RLS policies, and RPC functions for access codes, daily limits, duplicate/variation checks, and admin moderation

## Quick Setup
1. Push all files to your GitHub repository and enable **GitHub Pages**.
2. In **Supabase SQL Editor**, run `supabase/schema.sql`.
3. Update the placeholder `access_code` values in `public.contributors` in Supabase.
4. Paste your Supabase **Project URL** and **anon key** into `js/config.js` and push.
5. Sign in with your Admin access code (`ADMIN-FUHSO-01` initially until changed) to manage contributors, approve phrase submissions/requests, and approve voice clips for all users.

## Future AI Integration Path
Because phrases, syllables, tone notes, and approved audio clips are stored in structured PostgreSQL tables (`phrases`, `audio_clips`), future AI features (such as clinical symptom clustering, study question generation, or reference audio matching) can query verified records directly rather than relying on unverified free-text guesswork.
