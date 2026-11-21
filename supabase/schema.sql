-- ============================================================================
-- Idoma Medical Phrasebook - Supabase schema + RPCs (v2, Nov 2026)
-- Safe to re-run on the live database: it only creates what is missing,
-- replaces functions, and does NOT insert any default contributors or codes.
-- Adds: Alala column, volunteer_request submissions, app_settings (live ASR URL),
-- admin_set_setting, tighter guest policies, audio upload size limit.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Contributors ------------------------------------------------------------
create table if not exists public.contributors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role_title text not null,
  access_code text not null unique,
  is_admin boolean not null default false,
  show_in_credits boolean not null default true,
  is_active boolean not null default true,
  daily_submission_limit integer not null default 40 check (daily_submission_limit > 0),
  daily_audio_limit integer not null default 40 check (daily_audio_limit > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contributors_code_active
  on public.contributors (access_code) where is_active = true;

-- 2. Published phrases -------------------------------------------------------
create table if not exists public.phrases (
  id uuid primary key default gen_random_uuid(),
  phrase_code text unique,
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
  variation_label text,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_by_contributor_id uuid references public.contributors (id) on delete set null,
  updated_by_contributor_id uuid references public.contributors (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.phrases add column if not exists alala_term text;

create index if not exists idx_phrases_english_norm on public.phrases (english_normalized);
create index if not exists idx_phrases_section_sort on public.phrases (section, sort_order, english_normalized);

-- 3. Submissions (new phrase, edit, term request, volunteer request) ----------
create table if not exists public.phrase_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null,
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
  requester_label text,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  reviewer_notes text,
  reviewed_by_contributor_id uuid references public.contributors (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.phrase_submissions add column if not exists alala_term text;

-- allow volunteer_request (replaces the old 3-value check)
alter table public.phrase_submissions
  drop constraint if exists phrase_submissions_submission_type_check;
alter table public.phrase_submissions
  add constraint phrase_submissions_submission_type_check
  check (submission_type in ('new_phrase', 'edit_phrase', 'term_request', 'volunteer_request'));

create index if not exists idx_submissions_status on public.phrase_submissions (review_status, created_at desc);

-- 4. Audio clips -------------------------------------------------------------
create table if not exists public.audio_clips (
  id uuid primary key default gen_random_uuid(),
  phrase_id uuid not null references public.phrases (id) on delete cascade,
  recorded_by_contributor_id uuid references public.contributors (id) on delete set null,
  storage_bucket text not null default 'idoma-audio',
  storage_path text not null,
  mime_type text not null default 'audio/webm',
  duration_ms integer,
  dialect_note text,
  is_primary boolean not null default false,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  reviewer_notes text,
  reviewed_by_contributor_id uuid references public.contributors (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_audio_phrase_status on public.audio_clips (phrase_id, approval_status, is_primary desc);

create unique index if not exists uq_one_primary_approved_audio
  on public.audio_clips (phrase_id)
  where is_primary = true and approval_status = 'approved';

-- 5. App settings (live ASR URL etc.) ------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- 6. Triggers ----------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contributors_updated_at on public.contributors;
create trigger trg_contributors_updated_at
before update on public.contributors for each row execute function public.set_updated_at();

drop trigger if exists trg_phrases_updated_at on public.phrases;
create trigger trg_phrases_updated_at
before update on public.phrases for each row execute function public.set_updated_at();

-- 7. Storage bucket (audio) ----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('idoma-audio', 'idoma-audio', true)
on conflict (id) do nothing;

-- cap each upload at 5 MB so the public bucket can't be flooded with huge files
update storage.buckets set file_size_limit = 5242880 where id = 'idoma-audio';

-- 8. Row Level Security --------------------------------------------------------
alter table public.contributors enable row level security;
alter table public.phrases enable row level security;
alter table public.phrase_submissions enable row level security;
alter table public.audio_clips enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "Public read published phrases" on public.phrases;
create policy "Public read published phrases"
on public.phrases for select using (is_published = true);

drop policy if exists "Public read approved audio" on public.audio_clips;
create policy "Public read approved audio"
on public.audio_clips for select using (approval_status = 'approved');

-- Guests may only add a pending term/volunteer request with no contributor attached
drop policy if exists "Public insert submissions" on public.phrase_submissions;
create policy "Public insert submissions"
on public.phrase_submissions for insert
with check (
  submission_type in ('term_request', 'volunteer_request')
  and review_status = 'pending'
  and submitted_by_contributor_id is null
  and reviewed_by_contributor_id is null
);

-- Only the live ASR URL setting is readable by the public
drop policy if exists "Public read asr setting" on public.app_settings;
create policy "Public read asr setting"
on public.app_settings for select using (key = 'idoma_asr_url');

drop policy if exists "Public upload idoma audio" on storage.objects;
create policy "Public upload idoma audio"
on storage.objects for insert with check (bucket_id = 'idoma-audio');

drop policy if exists "Public read idoma audio" on storage.objects;
create policy "Public read idoma audio"
on storage.objects for select using (bucket_id = 'idoma-audio');

-- 9. Drop old overloads of functions whose signature changed ------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as func_sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_phrase_entry', 'admin_upsert_phrase')
  loop
    execute format('drop function if exists %s', r.func_sig);
  end loop;
end;
$$;

-- 10. Functions ------------------------------------------------------------------
create or replace function public.verify_contributor_code(p_code text)
returns table (
  id uuid,
  full_name text,
  role_title text,
  is_admin boolean,
  daily_submission_limit integer,
  daily_audio_limit integer
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  select c.id, c.full_name, c.role_title, c.is_admin, c.daily_submission_limit, c.daily_audio_limit
  from public.contributors c
  where c.access_code = trim(p_code)
    and c.is_active = true
  limit 1;
end;
$$;

create or replace function public.get_public_credits()
returns table (
  id uuid,
  full_name text,
  role_title text,
  notes text
)
language sql security definer set search_path = public as $$
  select c.id, c.full_name, c.role_title, c.notes
  from public.contributors c
  where c.is_active = true and c.show_in_credits = true
  order by c.is_admin desc, c.created_at asc;
$$;

create or replace function public.submit_phrase_entry(
  p_code text,
  p_submission_type text,
  p_target_phrase_id uuid,
  p_variation_of_id uuid,
  p_allow_variation boolean,
  p_section text,
  p_subsection text,
  p_english_term text,
  p_idoma_term text,
  p_alala_term text,
  p_syllables text,
  p_phonetic_hint text,
  p_tone_note text,
  p_clinical_note text,
  p_proposed_status text
)
returns public.phrase_submissions
language plpgsql security definer set search_path = public as $$
declare
  v_actor public.contributors%rowtype;
  v_today_count integer;
  v_dup_count integer;
  v_row public.phrase_submissions%rowtype;
begin
  select * into v_actor
  from public.contributors
  where access_code = trim(p_code) and is_active = true;

  if v_actor.id is null then
    raise exception 'Invalid or inactive access code.';
  end if;

  if p_submission_type not in ('new_phrase', 'edit_phrase', 'term_request', 'volunteer_request') then
    raise exception 'Invalid submission type.';
  end if;

  select count(*) into v_today_count
  from public.phrase_submissions
  where submitted_by_contributor_id = v_actor.id
    and created_at >= date_trunc('day', now());

  if v_today_count >= v_actor.daily_submission_limit then
    raise exception 'Daily submission limit reached (% per day).', v_actor.daily_submission_limit;
  end if;

  if p_submission_type = 'new_phrase' and not coalesce(p_allow_variation, false) then
    select count(*) into v_dup_count
    from public.phrases
    where english_normalized = lower(trim(regexp_replace(p_english_term, '\s+', ' ', 'g')));

    if v_dup_count > 0 then
      raise exception 'This English term already exists. Check "Mark as variation" if adding a dialect or phrasing variant.';
    end if;
  end if;

  insert into public.phrase_submissions (
    submission_type, target_phrase_id, variation_of_id, allow_variation,
    section, subsection, english_term, idoma_term, alala_term, syllables, phonetic_hint,
    tone_note, clinical_note, proposed_verification_status,
    submitted_by_contributor_id, requester_label, review_status
  ) values (
    p_submission_type, p_target_phrase_id, p_variation_of_id, coalesce(p_allow_variation, false),
    coalesce(nullif(trim(p_section), ''), 'General'), nullif(trim(p_subsection), ''),
    trim(p_english_term), nullif(trim(p_idoma_term), ''), nullif(trim(p_alala_term), ''),
    nullif(trim(p_syllables), ''), nullif(trim(p_phonetic_hint), ''),
    nullif(trim(p_tone_note), ''), nullif(trim(p_clinical_note), ''),
    coalesce(p_proposed_status, 'unconfirmed'), v_actor.id, v_actor.full_name, 'pending'
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.register_audio_clip(
  p_code text,
  p_phrase_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_duration_ms integer,
  p_dialect_note text
)
returns public.audio_clips
language plpgsql security definer set search_path = public as $$
declare
  v_actor public.contributors%rowtype;
  v_today_audio integer;
  v_clip public.audio_clips%rowtype;
begin
  select * into v_actor
  from public.contributors
  where access_code = trim(p_code) and is_active = true;

  if v_actor.id is null then
    raise exception 'Invalid or inactive contributor code.';
  end if;

  select count(*) into v_today_audio
  from public.audio_clips
  where recorded_by_contributor_id = v_actor.id
    and created_at >= date_trunc('day', now());

  if v_today_audio >= v_actor.daily_audio_limit then
    raise exception 'Daily audio upload limit reached (% per day).', v_actor.daily_audio_limit;
  end if;

  insert into public.audio_clips (
    phrase_id, recorded_by_contributor_id, storage_path, mime_type, duration_ms, dialect_note, approval_status
  ) values (
    p_phrase_id, v_actor.id, p_storage_path, coalesce(p_mime_type, 'audio/webm'), p_duration_ms, nullif(trim(p_dialect_note), ''), 'pending'
  ) returning * into v_clip;

  return v_clip;
end;
$$;

create or replace function public.admin_list_contributors(p_admin_code text)
returns setof public.contributors
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;
  return query select * from public.contributors order by is_admin desc, created_at asc;
end;
$$;

create or replace function public.admin_upsert_contributor(
  p_admin_code text,
  p_id uuid,
  p_full_name text,
  p_role_title text,
  p_access_code text,
  p_is_admin boolean,
  p_show_in_credits boolean,
  p_is_active boolean,
  p_daily_submission_limit integer,
  p_daily_audio_limit integer,
  p_notes text
)
returns public.contributors
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
  v_res public.contributors%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;

  if p_id is null then
    insert into public.contributors (
      full_name, role_title, access_code, is_admin, show_in_credits, is_active,
      daily_submission_limit, daily_audio_limit, notes
    ) values (
      trim(p_full_name), trim(p_role_title), trim(p_access_code), coalesce(p_is_admin, false),
      coalesce(p_show_in_credits, true), coalesce(p_is_active, true),
      coalesce(p_daily_submission_limit, 40), coalesce(p_daily_audio_limit, 40), nullif(trim(p_notes), '')
    ) returning * into v_res;
  else
    update public.contributors set
      full_name = trim(p_full_name),
      role_title = trim(p_role_title),
      access_code = trim(p_access_code),
      is_admin = coalesce(p_is_admin, is_admin),
      show_in_credits = coalesce(p_show_in_credits, show_in_credits),
      is_active = coalesce(p_is_active, is_active),
      daily_submission_limit = coalesce(p_daily_submission_limit, daily_submission_limit),
      daily_audio_limit = coalesce(p_daily_audio_limit, daily_audio_limit),
      notes = nullif(trim(p_notes), '')
    where id = p_id
    returning * into v_res;
  end if;

  return v_res;
end;
$$;

create or replace function public.admin_delete_contributor(p_admin_code text, p_target_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;
  delete from public.contributors where id = p_target_id;
end;
$$;

create or replace function public.admin_list_submissions(p_admin_code text)
returns setof public.phrase_submissions
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;
  return query select * from public.phrase_submissions order by (review_status = 'pending') desc, created_at desc;
end;
$$;

-- Approve/reject; approved new/edit phrases are promoted into public.phrases
create or replace function public.admin_review_submission(
  p_admin_code text,
  p_submission_id uuid,
  p_decision text,
  p_reviewer_notes text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
  v_sub public.phrase_submissions%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;

  select * into v_sub from public.phrase_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submission not found.'; end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  update public.phrase_submissions set
    review_status = p_decision,
    reviewer_notes = nullif(trim(p_reviewer_notes), ''),
    reviewed_by_contributor_id = v_admin.id,
    reviewed_at = now()
  where id = p_submission_id;

  if p_decision = 'approved' and v_sub.submission_type in ('new_phrase', 'edit_phrase') then
    if v_sub.target_phrase_id is not null then
      update public.phrases set
        section = coalesce(nullif(v_sub.section, ''), section),
        subsection = coalesce(v_sub.subsection, subsection),
        english_term = coalesce(nullif(v_sub.english_term, ''), english_term),
        idoma_term = coalesce(v_sub.idoma_term, idoma_term),
        alala_term = coalesce(v_sub.alala_term, alala_term),
        syllables = coalesce(v_sub.syllables, syllables),
        phonetic_hint = coalesce(v_sub.phonetic_hint, phonetic_hint),
        tone_note = coalesce(v_sub.tone_note, tone_note),
        clinical_note = coalesce(v_sub.clinical_note, clinical_note),
        verification_status = coalesce(v_sub.proposed_verification_status, verification_status),
        updated_by_contributor_id = v_sub.submitted_by_contributor_id
      where id = v_sub.target_phrase_id;
    else
      insert into public.phrases (
        section, subsection, english_term, idoma_term, alala_term, syllables, phonetic_hint,
        tone_note, clinical_note, verification_status, variation_of_id,
        variation_label, is_published, created_by_contributor_id
      ) values (
        v_sub.section, v_sub.subsection, v_sub.english_term, v_sub.idoma_term, v_sub.alala_term,
        v_sub.syllables, v_sub.phonetic_hint, v_sub.tone_note, v_sub.clinical_note,
        v_sub.proposed_verification_status, v_sub.variation_of_id,
        case when v_sub.allow_variation then 'Variant' else null end,
        true, v_sub.submitted_by_contributor_id
      );
    end if;
  end if;
end;
$$;

create or replace function public.admin_list_audio_clips(p_admin_code text)
returns setof public.audio_clips
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;
  return query select * from public.audio_clips order by (approval_status = 'pending') desc, created_at desc;
end;
$$;

create or replace function public.admin_review_audio_clip(
  p_admin_code text,
  p_clip_id uuid,
  p_decision text,
  p_set_primary boolean,
  p_reviewer_notes text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
  v_clip public.audio_clips%rowtype;
begin
  select * into v_admin from public.contributors where access_code = trim(p_admin_code) and is_active = true and is_admin = true;
  if v_admin.id is null then raise exception 'Admin privileges required.'; end if;

  select * into v_clip from public.audio_clips where id = p_clip_id;
  if v_clip.id is null then raise exception 'Audio clip not found.'; end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  if p_decision = 'approved' and coalesce(p_set_primary, true) then
    update public.audio_clips set is_primary = false where phrase_id = v_clip.phrase_id;
  end if;

  update public.audio_clips set
    approval_status = p_decision,
    is_primary = case when p_decision = 'approved' then coalesce(p_set_primary, true) else false end,
    reviewer_notes = nullif(trim(p_reviewer_notes), ''),
    reviewed_by_contributor_id = v_admin.id,
    reviewed_at = now()
  where id = p_clip_id;
end;
$$;

-- Admin: upsert phrase (used by seed sync and admin edits).
-- Blank Alala never erases an existing Alala form, so re-syncing the seed is safe.
-- Blank phrase_code updates the matching English term + section instead of duplicating.
create or replace function public.admin_upsert_phrase(
  p_admin_code text,
  p_phrase_code text,
  p_section text,
  p_subsection text,
  p_english_term text,
  p_idoma_term text,
  p_alala_term text,
  p_syllables text,
  p_phonetic_hint text,
  p_tone_note text,
  p_clinical_note text,
  p_verification_status text
)
returns public.phrases
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
  v_res public.phrases%rowtype;
  v_code text := nullif(trim(p_phrase_code), '');
  v_existing uuid;
begin
  select * into v_admin
  from public.contributors
  where access_code = trim(p_admin_code)
    and is_active = true
    and is_admin = true;

  if v_admin.id is null then
    raise exception 'Admin privileges required.';
  end if;

  if v_code is null then
    select id into v_existing
    from public.phrases
    where english_normalized = lower(trim(regexp_replace(p_english_term, '\s+', ' ', 'g')))
      and section = trim(p_section)
      and variation_of_id is null
    order by created_at asc
    limit 1;

    if v_existing is not null then
      update public.phrases set
        subsection = nullif(trim(p_subsection), ''),
        idoma_term = nullif(trim(p_idoma_term), ''),
        alala_term = coalesce(nullif(trim(p_alala_term), ''), alala_term),
        syllables = nullif(trim(p_syllables), ''),
        phonetic_hint = nullif(trim(p_phonetic_hint), ''),
        tone_note = nullif(trim(p_tone_note), ''),
        clinical_note = nullif(trim(p_clinical_note), ''),
        verification_status = coalesce(p_verification_status, verification_status),
        updated_by_contributor_id = v_admin.id
      where id = v_existing
      returning * into v_res;
      return v_res;
    end if;
  end if;

  insert into public.phrases (
    phrase_code, section, subsection, english_term, idoma_term, alala_term,
    syllables, phonetic_hint, tone_note, clinical_note, verification_status,
    is_published, created_by_contributor_id
  ) values (
    v_code, trim(p_section), nullif(trim(p_subsection), ''),
    trim(p_english_term), nullif(trim(p_idoma_term), ''), nullif(trim(p_alala_term), ''),
    nullif(trim(p_syllables), ''), nullif(trim(p_phonetic_hint), ''),
    nullif(trim(p_tone_note), ''), nullif(trim(p_clinical_note), ''),
    coalesce(p_verification_status, 'unconfirmed'), true, v_admin.id
  )
  on conflict (phrase_code) do update set
    section = excluded.section,
    subsection = excluded.subsection,
    english_term = excluded.english_term,
    idoma_term = excluded.idoma_term,
    alala_term = coalesce(excluded.alala_term, public.phrases.alala_term),
    syllables = excluded.syllables,
    phonetic_hint = excluded.phonetic_hint,
    tone_note = excluded.tone_note,
    clinical_note = excluded.clinical_note,
    verification_status = excluded.verification_status,
    updated_by_contributor_id = v_admin.id
  returning * into v_res;

  return v_res;
end;
$$;

-- Admin: set an app setting (live ASR URL)
create or replace function public.admin_set_setting(
  p_admin_code text,
  p_key text,
  p_value text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin public.contributors%rowtype;
begin
  select * into v_admin
  from public.contributors
  where access_code = trim(p_admin_code) and is_active = true and is_admin = true;

  if v_admin.id is null then
    raise exception 'Admin privileges required.';
  end if;

  if p_key is null or trim(p_key) = '' then
    raise exception 'Setting key required.';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values (trim(p_key), nullif(trim(p_value), ''), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

-- Make the API pick up the new tables/functions immediately
notify pgrst, 'reload schema';
