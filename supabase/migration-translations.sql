-- ============================================================================
-- Idoma Medical Phrasebook - Multi-language groundwork (translations table)
-- ADDITIVE ONLY: nothing is dropped or renamed, so the current app keeps working.
-- Run AFTER schema.sql. Safe to re-run.
--
-- Idea: a phrase is the English concept; each language/dialect form of it is a
-- row in phrase_translations. Idoma and Alala become two rows, and a new language
-- (Igala, Tiv, Etulo...) is just more rows - no new columns, no rebuild.
--
-- While the app still reads phrases.idoma_term / phrases.alala_term, a trigger
-- keeps phrase_translations in sync automatically.
-- ============================================================================

-- 1. Languages ---------------------------------------------------------------
create table if not exists public.languages (
  code text primary key,            -- ISO 639-3 where one exists (Idoma = idu)
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.languages (code, name)
values ('idu', 'Idoma')
on conflict (code) do nothing;

-- 2. Translations (one row per phrase + language + dialect) ------------------
-- dialect: null = general/standard form; otherwise e.g. 'alala', 'otukpo', 'agatu'
create table if not exists public.phrase_translations (
  id uuid primary key default gen_random_uuid(),
  phrase_id uuid not null references public.phrases (id) on delete cascade,
  language_code text not null references public.languages (code),
  dialect text,
  term text not null,
  syllables text,
  phonetic_hint text,
  tone_note text,
  verification_status text not null default 'unconfirmed'
    check (verification_status in ('verified', 'unconfirmed', 'missing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_translation_phrase_lang_dialect
  on public.phrase_translations (phrase_id, language_code, coalesce(dialect, ''));

create index if not exists idx_translation_lang
  on public.phrase_translations (language_code, dialect);

drop trigger if exists trg_translations_updated_at on public.phrase_translations;
create trigger trg_translations_updated_at
before update on public.phrase_translations for each row execute function public.set_updated_at();

-- 3. Link audio to a specific translation (optional, filled in later) --------
alter table public.audio_clips
  add column if not exists translation_id uuid references public.phrase_translations (id) on delete set null;

-- 4. Row Level Security ------------------------------------------------------
alter table public.languages enable row level security;
alter table public.phrase_translations enable row level security;

drop policy if exists "Public read languages" on public.languages;
create policy "Public read languages"
on public.languages for select using (is_active = true);

drop policy if exists "Public read published translations" on public.phrase_translations;
create policy "Public read published translations"
on public.phrase_translations for select
using (exists (
  select 1 from public.phrases p
  where p.id = phrase_translations.phrase_id and p.is_published = true
));

-- 5. Backfill from the existing columns --------------------------------------
-- Idoma (general form) keeps the phrase's existing syllables / phonetic / tone / status.
insert into public.phrase_translations
  (phrase_id, language_code, dialect, term, syllables, phonetic_hint, tone_note, verification_status)
select p.id, 'idu', null, trim(p.idoma_term), p.syllables, p.phonetic_hint, p.tone_note, p.verification_status
from public.phrases p
where nullif(trim(p.idoma_term), '') is not null
on conflict (phrase_id, language_code, (coalesce(dialect, ''))) do nothing;

-- Alala: term only. Its verification status is not known, so it starts as unconfirmed.
insert into public.phrase_translations
  (phrase_id, language_code, dialect, term, verification_status)
select p.id, 'idu', 'alala', trim(p.alala_term), 'unconfirmed'
from public.phrases p
where nullif(trim(p.alala_term), '') is not null
on conflict (phrase_id, language_code, (coalesce(dialect, ''))) do nothing;

-- 6. Keep translations in sync while the app still writes the old columns -----
create or replace function public.sync_phrase_translations()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Idoma (general form)
  if nullif(trim(new.idoma_term), '') is not null then
    insert into public.phrase_translations
      (phrase_id, language_code, dialect, term, syllables, phonetic_hint, tone_note, verification_status)
    values
      (new.id, 'idu', null, trim(new.idoma_term), new.syllables, new.phonetic_hint, new.tone_note, new.verification_status)
    on conflict (phrase_id, language_code, (coalesce(dialect, ''))) do update set
      term = excluded.term,
      syllables = excluded.syllables,
      phonetic_hint = excluded.phonetic_hint,
      tone_note = excluded.tone_note,
      verification_status = excluded.verification_status;
  else
    delete from public.phrase_translations
    where phrase_id = new.id and language_code = 'idu' and dialect is null;
  end if;

  -- Alala (term only; never overwrites its own status/notes)
  if nullif(trim(new.alala_term), '') is not null then
    insert into public.phrase_translations
      (phrase_id, language_code, dialect, term, verification_status)
    values
      (new.id, 'idu', 'alala', trim(new.alala_term), 'unconfirmed')
    on conflict (phrase_id, language_code, (coalesce(dialect, ''))) do update set
      term = excluded.term;
  else
    delete from public.phrase_translations
    where phrase_id = new.id and language_code = 'idu' and dialect = 'alala';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_phrases_sync_translations on public.phrases;
create trigger trg_phrases_sync_translations
after insert or update of idoma_term, alala_term, syllables, phonetic_hint, tone_note, verification_status
on public.phrases
for each row execute function public.sync_phrase_translations();

-- 7. Convenience view for the future app: one row per phrase with all forms ----
drop view if exists public.v_phrases_translated;
create view public.v_phrases_translated
with (security_invoker = true) as
select
  p.id, p.phrase_code, p.section, p.subsection, p.english_term,
  p.verification_status, p.sort_order,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'language', t.language_code,
        'dialect', t.dialect,
        'term', t.term,
        'syllables', t.syllables,
        'phonetic_hint', t.phonetic_hint,
        'tone_note', t.tone_note,
        'status', t.verification_status
      ) order by t.language_code, t.dialect nulls first
    ) filter (where t.id is not null),
    '[]'::jsonb
  ) as translations
from public.phrases p
left join public.phrase_translations t on t.phrase_id = p.id
where p.is_published = true
group by p.id;

grant select on public.v_phrases_translated to anon, authenticated;

notify pgrst, 'reload schema';

-- Quick check after running:
--   select language_code, dialect, count(*) from public.phrase_translations group by 1, 2;
--   select english_term, translations from public.v_phrases_translated limit 5;
