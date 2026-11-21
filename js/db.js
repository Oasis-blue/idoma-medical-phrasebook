(function () {
  const LOCAL_KEYS = {
    phrases: "idoma_pb_phrases_v2",
    contributors: "idoma_pb_contributors_v2",
    submissions: "idoma_pb_submissions_v2",
    audio: "idoma_pb_audio_v2",
    session: "idoma_pb_session_v1",
    tray: "idoma_pb_tray_v1"
  };

  const DEFAULT_CONTRIBUTORS = [
    { id: "c-alex", full_name: "Alex Sunday Okoh", role_title: "Author & Lead Builder", access_code: "ADMIN-FUHSO-01", is_admin: true, show_in_credits: true, is_active: true, daily_submission_limit: 200, daily_audio_limit: 200, notes: "300-level MBBS student, FUHSO" },
    { id: "c-grace", full_name: "Grace Adini", role_title: "Translation", access_code: "CONT-GRACE-01", is_admin: false, show_in_credits: true, is_active: true, daily_submission_limit: 50, daily_audio_limit: 50, notes: "Translation contributor" },
    { id: "c-ben", full_name: "Ben Odeh", role_title: "Dialect review", access_code: "CONT-BEN-01", is_admin: false, show_in_credits: true, is_active: true, daily_submission_limit: 50, daily_audio_limit: 50, notes: "Dialect review contributor" },
    { id: "c-jude", full_name: "Dr Jude A", role_title: "Clinical accuracy review", access_code: "CONT-JUDE-01", is_admin: false, show_in_credits: true, is_active: true, daily_submission_limit: 50, daily_audio_limit: 50, notes: "Clinical accuracy reviewer" },
    { id: "c-james", full_name: "James Gabriel", role_title: "Proofreading", access_code: "CONT-JAMES-01", is_admin: false, show_in_credits: true, is_active: true, daily_submission_limit: 50, daily_audio_limit: 50, notes: "Proofreading contributor" },
    { id: "c-peace", full_name: "Peace Onogwu", role_title: "Alala (Orokam) translation", access_code: "CONT-PEACE-01", is_admin: false, show_in_credits: true, is_active: true, daily_submission_limit: 50, daily_audio_limit: 50, notes: "Alala (Orokam) dialect contributor" }
  ];

  let supabaseClient = null;
  let isLiveDb = false;

  function initClient() {
    const cfg = window.APP_CONFIG || {};
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && typeof window.supabase.createClient === "function") {
      supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      isLiveDb = true;
    } else {
      isLiveDb = false;
    }
    return isLiveDb;
  }

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn("Storage write warning:", e);
    }
  }

  function getTrayIds() {
    return new Set(readLocal(LOCAL_KEYS.tray, []));
  }

  function saveTrayIds(setObj) {
    writeLocal(LOCAL_KEYS.tray, Array.from(setObj));
  }

  function normalizePhrase(p) {
    return {
      id: p.id,
      code: p.code || p.phrase_code || "",
      section: p.section || "General",
      subsection: p.subsection || "",
      english: p.english || p.english_term || "",
      idoma: p.idoma ?? p.idoma_term ?? "",
      alala: p.alala ?? p.alala_term ?? "",
      syllables: p.syllables || "",
      phonetic: p.phonetic || p.phonetic_hint || "",
      tone: p.tone || p.tone_note || "",
      clinical: p.clinical || p.clinical_note || "",
      status: p.status || p.verification_status || ((p.idoma || p.alala) ? "unconfirmed" : "missing"),
      variation_of_id: p.variation_of_id || null,
      variation_label: p.variation_label || "",
      sort_order: p.sort_order ?? 0
    };
  }

  async function loadSeedPhrases() {
    try {
      const res = await fetch("./data/seed-phrases.json", { cache: "no-store" });
      if (!res.ok) throw new Error("Seed JSON fetch failed");
      const data = await res.json();
      return Array.isArray(data)
        ? data.map((item, idx) => normalizePhrase({ ...item, id: item.id || `seed-${idx + 1}`, sort_order: idx + 1 }))
        : [];
    } catch (e) {
      console.warn("Seed fetch fallback:", e);
      return [];
    }
  }

  function ensureLocalStore(seedList) {
    let localPhrases = readLocal(LOCAL_KEYS.phrases, null);
    if (!Array.isArray(localPhrases) || localPhrases.length === 0) {
      localPhrases = seedList;
      writeLocal(LOCAL_KEYS.phrases, localPhrases);
    } else {
      localPhrases = localPhrases.map(normalizePhrase);
    }

    let contribs = readLocal(LOCAL_KEYS.contributors, null);
    if (!Array.isArray(contribs) || contribs.length === 0) {
      contribs = DEFAULT_CONTRIBUTORS;
      writeLocal(LOCAL_KEYS.contributors, contribs);
    }

    let subs = readLocal(LOCAL_KEYS.submissions, null);
    if (!Array.isArray(subs)) {
      subs = [];
      writeLocal(LOCAL_KEYS.submissions, subs);
    }

    let clips = readLocal(LOCAL_KEYS.audio, null);
    if (!Array.isArray(clips)) {
      clips = [];
      writeLocal(LOCAL_KEYS.audio, clips);
    }

    return { localPhrases, contribs, subs, clips };
  }

  async function fetchPhrases(seedList) {
    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient
        .from("phrases")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        return { phrases: data.map(normalizePhrase), source: "supabase" };
      }
    }
    const { localPhrases } = ensureLocalStore(seedList);
    return { phrases: localPhrases, source: isLiveDb ? "supabase-empty-fallback" : "local-browser" };
  }

  async function fetchApprovedAudioMap() {
    const map = {};
    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient
        .from("audio_clips")
        .select("*")
        .eq("approval_status", "approved")
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        const bucket = (window.APP_CONFIG && window.APP_CONFIG.AUDIO_BUCKET) || "idoma-audio";
        for (const clip of data) {
          if (!map[clip.phrase_id]) {
            const { data: pub } = supabaseClient.storage.from(bucket).getPublicUrl(clip.storage_path);
            map[clip.phrase_id] = {
              id: clip.id,
              url: pub ? pub.publicUrl : "",
              dialect_note: clip.dialect_note || "",
              mime_type: clip.mime_type
            };
          }
        }
        return map;
      }
    }
    const clips = readLocal(LOCAL_KEYS.audio, []);
    for (const clip of clips) {
      if (clip.approval_status === "approved" && clip.data_url && !map[clip.phrase_id]) {
        map[clip.phrase_id] = {
          id: clip.id,
          url: clip.data_url,
          dialect_note: clip.dialect_note || "",
          mime_type: clip.mime_type || "audio/webm"
        };
      }
    }
    return map;
  }

  async function fetchPublicCredits() {
    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient.rpc("get_public_credits");
      if (!error && Array.isArray(data)) return data;
    }
    const contribs = readLocal(LOCAL_KEYS.contributors, DEFAULT_CONTRIBUTORS);
    return contribs.filter((c) => c.is_active !== false && c.show_in_credits !== false);
  }

  async function loginWithCode(code) {
    const clean = (code || "").trim();
    if (!clean) throw new Error("Please enter an access code.");

    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient.rpc("verify_contributor_code", { p_code: clean });
      if (error) throw new Error(error.message || "Code verification failed.");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.id) throw new Error("Invalid or inactive access code.");
      const session = {
        id: row.id,
        full_name: row.full_name,
        role_title: row.role_title,
        is_admin: Boolean(row.is_admin),
        access_code: clean,
        daily_submission_limit: row.daily_submission_limit,
        daily_audio_limit: row.daily_audio_limit
      };
      writeLocal(LOCAL_KEYS.session, session);
      return session;
    }

    const contribs = readLocal(LOCAL_KEYS.contributors, DEFAULT_CONTRIBUTORS);
    const match = contribs.find((c) => c.access_code === clean && c.is_active !== false);
    if (!match) throw new Error("Code not found.");
    const session = { ...match };
    writeLocal(LOCAL_KEYS.session, session);
    return session;
  }

  function getSavedSession() {
    return readLocal(LOCAL_KEYS.session, null);
  }

  function clearSavedSession() {
    localStorage.removeItem(LOCAL_KEYS.session);
  }

  async function submitPhraseOrRequest(payload, session) {
    const isAuthenticated = Boolean(session && session.access_code);
    const submissionType = payload.submission_type || (isAuthenticated ? "new_phrase" : "term_request");

    if (isLiveDb && supabaseClient && isAuthenticated) {
      const { data, error } = await supabaseClient.rpc("submit_phrase_entry", {
        p_code: session.access_code,
        p_submission_type: submissionType,
        p_target_phrase_id: payload.target_phrase_id || null,
        p_variation_of_id: payload.variation_of_id || null,
        p_allow_variation: Boolean(payload.allow_variation),
        p_section: payload.section || "General",
        p_subsection: payload.subsection || null,
        p_english_term: payload.english_term,
        p_idoma_term: payload.idoma_term || null,
        p_alala_term: payload.alala_term || null,
        p_syllables: payload.syllables || null,
        p_phonetic_hint: payload.phonetic_hint || null,
        p_tone_note: payload.tone_note || null,
        p_clinical_note: payload.clinical_note || null,
        p_proposed_status: payload.proposed_status || "unconfirmed"
      });
      if (error) throw new Error(error.message);
      return data;
    }

    if (isLiveDb && supabaseClient && !isAuthenticated) {
      const { data, error } = await supabaseClient
        .from("phrase_submissions")
        .insert([{
          submission_type: "term_request",
          section: payload.section || "General",
          english_term: payload.english_term,
          clinical_note: payload.clinical_note || null,
          requester_label: payload.requester_label || "Public user",
          review_status: "pending"
        }]);
      if (error) throw new Error(error.message);
      return data || { ok: true };
    }

    const subs = readLocal(LOCAL_KEYS.submissions, []);
    const newSub = {
      id: "sub-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      submission_type: submissionType,
      target_phrase_id: payload.target_phrase_id || null,
      variation_of_id: payload.variation_of_id || null,
      allow_variation: Boolean(payload.allow_variation),
      section: payload.section || "General",
      subsection: payload.subsection || "",
      english_term: payload.english_term,
      idoma_term: payload.idoma_term || "",
      alala_term: payload.alala_term || "",
      syllables: payload.syllables || "",
      phonetic_hint: payload.phonetic_hint || "",
      tone_note: payload.tone_note || "",
      clinical_note: payload.clinical_note || "",
      proposed_verification_status: payload.proposed_status || "unconfirmed",
      requester_label: isAuthenticated ? session.full_name : (payload.requester_label || "Public user"),
      submitted_by_contributor_id: isAuthenticated ? session.id : null,
      review_status: "pending",
      created_at: new Date().toISOString()
    };
    subs.unshift(newSub);
    writeLocal(LOCAL_KEYS.submissions, subs);
    return newSub;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function uploadAudioRecording({ phraseId, blob, mimeType, durationMs, dialectNote }, session) {
    if (!session || !session.access_code) {
      throw new Error("Sign in with a contributor or admin access code to record and submit audio.");
    }
    if (!phraseId) throw new Error("Select a phrase before recording audio.");

    if (isLiveDb && supabaseClient) {
      const bucket = (window.APP_CONFIG && window.APP_CONFIG.AUDIO_BUCKET) || "idoma-audio";
      const ext = (mimeType || "").includes("mp4") ? "mp4" : "webm";
      const filePath = `${phraseId}/${session.id || "contrib"}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabaseClient.storage
        .from(bucket)
        .upload(filePath, blob, { contentType: mimeType || "audio/webm", upsert: false });

      if (upErr) throw new Error("Audio upload failed: " + upErr.message);

      const { data, error: rpcErr } = await supabaseClient.rpc("register_audio_clip", {
        p_code: session.access_code,
        p_phrase_id: phraseId,
        p_storage_path: filePath,
        p_mime_type: mimeType || "audio/webm",
        p_duration_ms: durationMs || null,
        p_dialect_note: dialectNote || null
      });
      if (rpcErr) throw new Error(rpcErr.message);
      return data;
    }

    const dataUrl = await blobToDataUrl(blob);
    const clips = readLocal(LOCAL_KEYS.audio, []);
    const clip = {
      id: "aud-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      phrase_id: phraseId,
      recorded_by_contributor_id: session.id,
      recorder_name: session.full_name,
      data_url: dataUrl,
      mime_type: mimeType || "audio/webm",
      duration_ms: durationMs || null,
      dialect_note: dialectNote || "",
      is_primary: false,
      approval_status: "pending",
      created_at: new Date().toISOString()
    };
    clips.unshift(clip);
    writeLocal(LOCAL_KEYS.audio, clips);
    return clip;
  }

  async function adminGetData(session) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const [cRes, sRes, aRes] = await Promise.all([
        supabaseClient.rpc("admin_list_contributors", { p_admin_code: session.access_code }),
        supabaseClient.rpc("admin_list_submissions", { p_admin_code: session.access_code }),
        supabaseClient.rpc("admin_list_audio_clips", { p_admin_code: session.access_code })
      ]);
      if (cRes.error) throw new Error(cRes.error.message);
      if (sRes.error) throw new Error(sRes.error.message);
      if (aRes.error) throw new Error(aRes.error.message);
      return {
        contributors: cRes.data || [],
        submissions: sRes.data || [],
        audioClips: aRes.data || []
      };
    }

    return {
      contributors: readLocal(LOCAL_KEYS.contributors, DEFAULT_CONTRIBUTORS),
      submissions: readLocal(LOCAL_KEYS.submissions, []),
      audioClips: readLocal(LOCAL_KEYS.audio, [])
    };
  }

  async function adminUpsertContributor(session, c) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient.rpc("admin_upsert_contributor", {
        p_admin_code: session.access_code,
        p_id: c.id || null,
        p_full_name: c.full_name,
        p_role_title: c.role_title,
        p_access_code: c.access_code,
        p_is_admin: Boolean(c.is_admin),
        p_show_in_credits: c.show_in_credits !== false,
        p_is_active: c.is_active !== false,
        p_daily_submission_limit: Number(c.daily_submission_limit) || 40,
        p_daily_audio_limit: Number(c.daily_audio_limit) || 40,
        p_notes: c.notes || null
      });
      if (error) throw new Error(error.message);
      return data;
    }

    const list = readLocal(LOCAL_KEYS.contributors, DEFAULT_CONTRIBUTORS);
    if (c.id) {
      const idx = list.findIndex((x) => x.id === c.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...c };
    } else {
      list.push({
        ...c,
        id: "c-" + Date.now(),
        daily_submission_limit: Number(c.daily_submission_limit) || 40,
        daily_audio_limit: Number(c.daily_audio_limit) || 40
      });
    }
    writeLocal(LOCAL_KEYS.contributors, list);
    return c;
  }

  async function adminDeleteContributor(session, targetId) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const { error } = await supabaseClient.rpc("admin_delete_contributor", {
        p_admin_code: session.access_code,
        p_target_id: targetId
      });
      if (error) throw new Error(error.message);
      return;
    }
    const list = readLocal(LOCAL_KEYS.contributors, DEFAULT_CONTRIBUTORS).filter((x) => x.id !== targetId);
    writeLocal(LOCAL_KEYS.contributors, list);
  }

  async function adminReviewSubmission(session, submissionId, decision, notes, seedList) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const { error } = await supabaseClient.rpc("admin_review_submission", {
        p_admin_code: session.access_code,
        p_submission_id: submissionId,
        p_decision: decision,
        p_reviewer_notes: notes || null
      });
      if (error) throw new Error(error.message);
      return;
    }

    const subs = readLocal(LOCAL_KEYS.submissions, []);
    const sub = subs.find((s) => s.id === submissionId);
    if (!sub) return;
    sub.review_status = decision;
    sub.reviewer_notes = notes || "";
    writeLocal(LOCAL_KEYS.submissions, subs);

    if (decision === "approved" && sub.submission_type !== "term_request") {
      const { localPhrases } = ensureLocalStore(seedList);
      if (sub.target_phrase_id) {
        const idx = localPhrases.findIndex((p) => p.id === sub.target_phrase_id);
        if (idx >= 0) {
          localPhrases[idx] = normalizePhrase({
            ...localPhrases[idx],
            section: sub.section || localPhrases[idx].section,
            subsection: sub.subsection || localPhrases[idx].subsection,
            english: sub.english_term || localPhrases[idx].english,
            idoma: sub.idoma_term ?? localPhrases[idx].idoma,
            alala: sub.alala_term ?? localPhrases[idx].alala,
            syllables: sub.syllables ?? localPhrases[idx].syllables,
            phonetic: sub.phonetic_hint ?? localPhrases[idx].phonetic,
            tone: sub.tone_note ?? localPhrases[idx].tone,
            clinical: sub.clinical_note ?? localPhrases[idx].clinical,
            status: sub.proposed_verification_status || localPhrases[idx].status
          });
        }
      } else {
        localPhrases.unshift(normalizePhrase({
          id: "ph-" + Date.now(),
          section: sub.section || "General",
          subsection: sub.subsection || "",
          english: sub.english_term,
          idoma: sub.idoma_term || "",
          alala: sub.alala_term || "",
          syllables: sub.syllables || "",
          phonetic: sub.phonetic_hint || "",
          tone: sub.tone_note || "",
          clinical: sub.clinical_note || "",
          status: sub.proposed_verification_status || "unconfirmed",
          variation_of_id: sub.variation_of_id || null,
          variation_label: sub.allow_variation ? "Variant" : ""
        }));
      }
      writeLocal(LOCAL_KEYS.phrases, localPhrases);
    }
  }

  async function adminReviewAudioClip(session, clipId, decision, setPrimary, notes) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const { error } = await supabaseClient.rpc("admin_review_audio_clip", {
        p_admin_code: session.access_code,
        p_clip_id: clipId,
        p_decision: decision,
        p_set_primary: Boolean(setPrimary),
        p_reviewer_notes: notes || null
      });
      if (error) throw new Error(error.message);
      return;
    }

    const clips = readLocal(LOCAL_KEYS.audio, []);
    const target = clips.find((c) => c.id === clipId);
    if (!target) return;
    if (decision === "approved" && setPrimary) {
      for (const c of clips) {
        if (c.phrase_id === target.phrase_id) c.is_primary = false;
      }
    }
    target.approval_status = decision;
    target.is_primary = decision === "approved" ? Boolean(setPrimary) : false;
    target.reviewer_notes = notes || "";
    writeLocal(LOCAL_KEYS.audio, clips);
  }

  async function adminUpsertPhrase(session, phraseObj, seedList) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    if (isLiveDb && supabaseClient) {
      const { data, error } = await supabaseClient.rpc("admin_upsert_phrase", {
        p_admin_code: session.access_code,
        p_phrase_code: phraseObj.code || null,
        p_section: phraseObj.section || "General",
        p_subsection: phraseObj.subsection || null,
        p_english_term: phraseObj.english,
        p_idoma_term: phraseObj.idoma || null,
        p_alala_term: phraseObj.alala || null,
        p_syllables: phraseObj.syllables || null,
        p_phonetic_hint: phraseObj.phonetic || null,
        p_tone_note: phraseObj.tone || null,
        p_clinical_note: phraseObj.clinical || null,
        p_verification_status: phraseObj.status || "unconfirmed"
      });
      if (error) throw new Error(error.message);
      return normalizePhrase(data);
    }

    const { localPhrases } = ensureLocalStore(seedList);
    const norm = normalizePhrase({ ...phraseObj, id: phraseObj.id || "ph-" + Date.now() });
    const idx = localPhrases.findIndex((p) => (norm.code && p.code === norm.code) || p.id === norm.id);
    if (idx >= 0) localPhrases[idx] = norm;
    else localPhrases.unshift(norm);
    writeLocal(LOCAL_KEYS.phrases, localPhrases);
    return norm;
  }

  async function adminImportSeedBatch(session, seedList, onProgress) {
    if (!session || !session.is_admin) throw new Error("Admin access required.");
    let done = 0;
    for (const item of seedList) {
      await adminUpsertPhrase(session, item, seedList);
      done += 1;
      if (typeof onProgress === "function") onProgress(done, seedList.length);
    }
    return done;
  }

  window.PhraseDB = {
    initClient,
    isLive: () => isLiveDb,
    loadSeedPhrases,
    fetchPhrases,
    fetchApprovedAudioMap,
    fetchPublicCredits,
    loginWithCode,
    getSavedSession,
    clearSavedSession,
    getTrayIds,
    saveTrayIds,
    submitPhraseOrRequest,
    uploadAudioRecording,
    adminGetData,
    adminUpsertContributor,
    adminDeleteContributor,
    adminReviewSubmission,
    adminReviewAudioClip,
    adminUpsertPhrase,
    adminImportSeedBatch
  };
})();
