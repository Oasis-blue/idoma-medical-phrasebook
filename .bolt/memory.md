# Project memory

## Product intent & audience

- Phrase glossary / dialect lookup PWA with contributor access codes and admin tooling (stats, dialect management, feedback).
- Mobile-first audience; returning users expected.
- "Common Terms" glossary tab is a primary surface; entries appear only after admin import.

## Brand personality & voice

- Not yet inferred from explicit brand guidance; tone in suggestions is practical and security-aware.

## Visual design & UX direction

- Tabbed UI using `<button>` tabs with panels; lacks ARIA `role="tabpanel"` / `aria-labelledby` (accessibility gap).
- Splash screen displays for 4s on every load; consider skipping for returning users via `localStorage`.
- "Loading…" state for phrase list with no error/retry fallback if seed JSON fetch fails.
- Vanilla JS DOM rendering (no framework); non-module scripts.
- Empty states are role-aware: admins see actionable import instructions; visitors get a friendly redirect to Phrase Finder.
- Glossary cards support audio playback and pinning.

## Decisions, constraints & rationale

- Originally a plain HTML/JS PWA with no `package.json`; Bolt preview (Vite) could not start. Added minimal Vite config + `package.json` to fix blank preview.
- Service worker cache version is manually set (`v22.0`); must be bumped on content changes to avoid stale caches.
- Backend: Supabase with anon key, `contributors` table (plaintext access codes), RPC `verify_contributor_code`; `schema.sql` defines RLS policies that may be permissive — flagged for review.
- Search pipeline: synonym expansion + fuzzy edit-distance computed per input event; render is immediate, logging debounce is 1.5s.
- Glossary terms do NOT come from the seed JSON; seed file contains zero glossary entries. Terms enter the app only via Admin Studio → "Import Glossary JSON" tool. Empty glossary tab is expected until first import.
- Empty-state messaging for glossary improved to explain the situation instead of showing a generic "no matches" message.

## Open questions & assumptions

- Should access codes be hashed server-side and/or rate-limited?
- Are RLS policies strict enough for admin RPCs (stats, dialect, feedback)?
- Should splash skip for returning users or be shortened to ~1.5s?
- Does glossary scale justify precomputing a normalized search index?
- User lexicon may be in a non-JSON format (Excel, Word, plain text); import path for those formats not yet determined.