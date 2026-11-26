# Project memory

## Product intent & audience

- Phrase glossary / dialect lookup PWA with contributor access codes and admin tooling (stats, dialect management, feedback).
- Mobile-first audience; returning users expected.

## Brand personality & voice

- Not yet inferred from explicit brand guidance; tone in suggestions is practical and security-aware.

## Visual design & UX direction

- Tabbed UI using `<button>` tabs with panels; lacks ARIA `role="tabpanel"` / `aria-labelledby` (accessibility gap).
- Splash screen displays for 4s on every load; consider skipping for returning users via `localStorage`.
- "Loading…" state for phrase list with no error/retry fallback if seed JSON fetch fails.
- Vanilla JS DOM rendering (no framework); non-module scripts.

## Decisions, constraints & rationale

- Originally a plain HTML/JS PWA with no `package.json`; Bolt preview (Vite) could not start. Added minimal Vite config + `package.json` this turn to fix blank preview.
- Service worker cache version is manually set (`v22.0`); must be bumped on content changes to avoid stale caches.
- Backend: Supabase with anon key, `contributors` table (plaintext access codes), RPC `verify_contributor_code`; `schema.sql` defines RLS policies that may be permissive — flagged for review.
- Search pipeline: synonym expansion + fuzzy edit-distance computed per input event; render is immediate, logging debounce is 1.5s.

## Open questions & assumptions

- Should access codes be hashed server-side and/or rate-limited?
- Are RLS policies strict enough for admin RPCs (stats, dialect, feedback)?
- Should splash skip for returning users or be shortened to ~1.5s?
- Does glossary scale justify precomputing a normalized search index?
- User has not yet approved which quick-win fixes to apply.