-- ============================================================================
-- Idoma Medical Phrasebook - Supabase PostgreSQL Schema
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Contributors, Credits & Access Codes
-- ----------------------------------------------------------------------------
create table if not exists public.contributors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role_title text not null, -- e.g. 'Translation', 'Dialect review', 'Clinical accuracy review', 'Proofreading', 'Admin'
  access_code text not null unique,
  is_admin boolean not null default false,
  show_in_credits boolean not null default true,
  is_active boolean not null default true,
  daily_submission_limit integer not null default 50 check (daily_submission_limit > 0),
  daily_audio_limit integer not null default 50 check (daily_audio_limit > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contributors_access_code
  on public.contributors (access_code)
  where is_active = true;

create index if not exists idx_contributors_credits
  on public.contributors (is_active, show_in_credits, full_name);

-- ----------------------------------------------------------------------------
-- 2. Main Phrasebook Entries
-- ----------------------------------------------------------------------------
create table if not exists public.phrases (
  id uuid primary key default gen_random_uuid(),
  phrase_code text unique, -- optional human-readable ID like 'SEC4_PAIN_01'
  section text not null,
  subsection text,
  english_term text not null,
  english_normalized text generated always as (
    lower(trim(regexp_replace(english_term, '\s+', ' ', 'g')))
  ) stored,
  idoma_term text,
  syllables text,
  phonetic_hint text,
  tone_note text,
  clinical_note text,
  verification_status text not null default 'unconfirmed'
    check (verification_status in ('verified', 'unconfirmed', 'missing')),
  variation_of_id uuid references public.phrases (id) on delete set null,
  variation_label text, -- e.g. 'Dialect variant', 'Informal phrasing', 'Plural/singular'
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_by_contributor_id uuid references public.contributors (id) on delete set null,
  updated_by_contributor_id uuid references public.contributors (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phrases_section_sort
  on public.phrases (section, sort_order, english_normalized);

create index if not exists idx_phrases_english_norm
  on public.phrases (english_normalized);

create index if not exists idx_phrases_verification
  on public.phrases (verification_status, is_published);

create index if not exists idx_phrases_variation_of
  on public.phrases (variation_of_id);

-- ----------------------------------------------------------------------------
-- 3. Moderated Edits, New Entries & Requested Terms
-- ----------------------------------------------------------------------------
create table if not exists public.phrase_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null
    check (submission_type in ('new_phrase', 'edit_phrase', 'term_request')),
  target_phrase_id uuid references public.phrases (id) on delete set null,
  variation_of_id uuid references public.phrases (id) on delete set null,
  allow_variation boolean not null default false,
  section text not null default 'General',
  subsection text,
  english_term text not null,
  english_normalized text generated always as (
    lower(trim(regexp_replace(english_term, '\s+', ' ', 'g')))
  ) stored,
  idoma_term text,
  syllables text,
  phonetic_hint text,
  tone_note text,
  clinical_note text,
  proposed_verification_status text not null default 'unconfirmed'
    check (proposed_verification_status in ('verified', 'unconfirmed', 'missing')),
  submitted_by_contributor_id uuid references public.contributors (id) on delete set null,
  requester_label text, -- optional non-contributor label or anonymous request note
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  reviewer_notes text,
  reviewed_by_contributor_id uuid references public.contributors (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_submissions_status_created
  on public.phrase_submissions (review_status, created_at desc);

create index if not exists idx_submissions_english_norm
  on public.phrase_submissions (english_normalized);

create index if not exists idx_submissions_contributor_date
  on public.phrase_submissions (submitted_by_contributor_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Pronunciation Audio Clips (Moderated Before Public Playback)
-- ----------------------------------------------------------------------------
create table if not exists public.audio_clips (
  id uuid primary key default gen_random_uuid(),
  phrase_id uuid not null references public.phrases (id) on delete cascade,
  recorded_by_contributor_id uuid references public.contributors (id) on delete set null,
  storage_bucket text not null default 'idoma-audio',
  storage_path text not null,
  mime_type text not null default 'audio/webm',
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  dialect_note text,
  is_primary boolean not null default false,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  reviewer_notes text,
  reviewed_by_contributor_id uuid references public.contributors (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_audio_clips_phrase_status
  on public.audio_clips (phrase_id, approval_status, is_primary desc);

create index if not exists idx_audio_clips_pending
  on public.audio_clips (approval_status, created_at desc);

-- Ensure at most one primary approved clip per phrase
create unique index if not exists uq_audio_primary_per_phrase
  on public.audio_clips (phrase_id)
  where is_primary = true and approval_status = 'approved';

-- ----------------------------------------------------------------------------
-- 5. Updated-At Timestamp Trigger
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contributors_updated_at on public.contributors;
create trigger trg_contributors_updated_at
before update on public.contributors
for each row execute function public.set_updated_at();

drop trigger if exists trg_phrases_updated_at on public.phrases;
create trigger trg_phrases_updated_at
before update on public.phrases
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Storage Bucket for Pronunciation Recordings
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('idoma-audio', 'idoma-audio', true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 7. Seed Initial Contributors & Admin
--    Replace access codes with strong private codes before deploying!
-- ----------------------------------------------------------------------------
insert into public.contributors
  (full_name, role_title, access_code, is_admin, show_in_credits, is_active, notes)
values
  ('Alex Sunday Okoh', 'Author & Lead Builder', 'ADMIN-FUHSO-01', true, true, true, '300-level MBBS student, FUHSO'),
  ('Grace Adini', 'Translation', 'CONT-GRACE-01', false, true, true, 'Initial phrasebook translation contributor'),
  ('Ben Odeh', 'Dialect review', 'CONT-BEN-01', false, true, true, 'Dialect review contributor'),
  ('Dr Jude A', 'Clinical accuracy review', 'CONT-JUDE-01', false, true, true, 'Clinical accuracy reviewer'),
  ('James Gabriel', 'Proofreading', 'CONT-JAMES-01', false, true, true, 'Proofreading contributor')
on conflict (access_code) do nothing;

-- ----------------------------------------------------------------------------
-- 8. Row Level Security (Baseline Starter Policies)
--    Tighten policies as you add Supabase Auth or RPC checks in production.
-- ----------------------------------------------------------------------------
alter table public.contributors enable row level security;
alter table public.phrases enable row level security;
alter table public.phrase_submissions enable row level security;
alter table public.audio_clips enable row level security;

-- Public can view published phrases
drop policy if exists "Public read published phrases" on public.phrases;
create policy "Public read published phrases"
on public.phrases for select
using (is_published = true);

-- Public can view approved audio clips
drop policy if exists "Public read approved audio clips" on public.audio_clips;
create policy "Public read approved audio clips"
on public.audio_clips for select
using (approval_status = 'approved');

-- Public can view active contributors marked for credits
drop policy if exists "Public read credited contributors" on public.contributors;
create policy "Public read credited contributors"
on public.contributors for select
using (is_active = true and show_in_credits = true);

-- Anyone can submit a term request or draft edit into moderation queue
drop policy if exists "Anyone can insert submissions" on public.phrase_submissions;
create policy "Anyone can insert submissions"
on public.phrase_submissions for insert
with check (true);
