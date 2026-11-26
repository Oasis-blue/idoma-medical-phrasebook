(function () {
  const DB = window.PhraseDB;
  const Matcher = window.AudioMatcher;

  let seedPhrases = [];
  let phrases = [];
  let audioMap = {};
  let credits = [];
  let session = null;
  let trayIds = new Set();

  let bedsideMode = false;
  let dialectOnly = false;
  let activeSection = "ALL";
  let activeStatus = "ALL";

  // The Common Terms Glossary lives in the same table but stays off the home list.
  const ALALA_DEFAULT = "Alala (Orokam)";
  let alalaLabel = ALALA_DEFAULT;
  const alalaShort = () => (alalaLabel.replace(/\s*\(.*?\)\s*/g, " ").trim() || alalaLabel);
  const normalizeForFilter = (s) => String(s || "").toLowerCase()
    .replace(/ɔ/g, "o").replace(/ɛ/g, "e").replace(/ŋ/g, "ng").replace(/[’‘ʼ]/g, "'")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // The dialect name is admin-editable (stored as a setting); static text is refreshed here.
  function applyDialectLabel() {
    const full = alalaLabel;
    const short = alalaShort();
    document.querySelectorAll("option").forEach((o) => {
      if (o.dataset.alalaOpt === undefined && o.textContent.trim() !== ALALA_DEFAULT) return;
      o.dataset.alalaOpt = "1";
      o.textContent = full;
      if (o.value === ALALA_DEFAULT || o.dataset.alalaVal === "1") {
        o.value = full;
        o.dataset.alalaVal = "1";
      }
    });
    document.querySelectorAll("[data-alala-label]").forEach((el) => { el.textContent = full; });
    document.querySelectorAll("input[placeholder]").forEach((el) => {
      if (el.dataset.phOrig === undefined) {
        if (!/Alala/.test(el.placeholder)) return;
        el.dataset.phOrig = el.placeholder;
      }
      el.placeholder = el.dataset.phOrig.replace(/Alala \(Orokam\)/g, full).replace(/Alala/g, short);
    });
  }

  // Special acknowledgments: one per line in Admin Studio, shown in Guide & Credits
  const DEFAULT_ACK = [
    "CMDA (Christian Medical and Dental Association)",
    "CMDA FUHSO",
    "Dr. Eli",
    "the Pioneers",
    "the Mavericks",
    "all native speakers and elders who verified terms"
  ];
  let specialAck = DEFAULT_ACK.slice();
  const formatAckList = (items) => {
    const l = items.filter(Boolean);
    if (l.length <= 1) return l[0] || "";
    if (l.length === 2) return `${l[0]} and ${l[1]}`;
    return `${l.slice(0, -1).join(", ")}, and ${l[l.length - 1]}`;
  };
  function applySpecialAck() {
    const el = $("specialAckText");
    if (el) el.textContent = formatAckList(specialAck) + ".";
  }
  async function syncAckFromDb() {
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) return;
    try {
      const url = `${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/app_settings?key=eq.special_acknowledgments&select=value`;
      const res = await fetch(url, {
        headers: {
          apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const val = Array.isArray(rows) && rows[0]?.value ? String(rows[0].value) : "";
      const lines = val.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
      specialAck = lines.length ? lines : DEFAULT_ACK.slice();
    } catch (_) { /* keep default */ }
  }

  // Dialect list (admin-managed). 'other' is always offered as a built-in choice.
  let dialects = [
    { code: "idoma", label: "Idoma (general)" },
    { code: "alala", label: ALALA_DEFAULT }
  ];
  const dialectLabelFor = (code) => {
    if (!code) return "";
    if (code === "other") return "Other dialect";
    const d = dialects.find((x) => x.code === code);
    return d ? d.label : code;
  };
  async function syncDialectsFromDb() {
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) return;
    try {
      const url = `${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/dialects?select=code,label,sort_order&is_active=eq.true&order=sort_order.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) {
        dialects = rows.map((r) => ({ code: r.code, label: r.label }));
        const al = rows.find((r) => r.code === "alala");
        alalaLabel = al ? al.label : ALALA_DEFAULT;
      }
    } catch (_) { /* keep defaults */ }
  }
  function renderDialectOptions() {
    const sel = $("audioDialect");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = dialects.map((d) => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.label)}</option>`).join("")
      + '<option value="other">Other dialect (say which in the note below)</option>';
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  }

  async function refreshPhrasesFromDb() {
    const refreshed = await DB.fetchPhrases(seedPhrases);
    phrases = refreshed.phrases;
    renderSectionPills();
    populateAudioPhraseSelect();
    renderPhrases();
    renderPracticeCard();
  }

  async function syncDialectLabelFromDb() {
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) return;
    try {
      const url = `${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/app_settings?key=eq.dialect_alala_label&select=value`;
      const res = await fetch(url, {
        headers: {
          apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const val = Array.isArray(rows) && rows[0]?.value ? String(rows[0].value).trim() : "";
      alalaLabel = val || ALALA_DEFAULT;
    } catch (_) { /* keep default */ }
  }

  async function saveSettingToDb(key, value) {
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) {
      throw new Error("Supabase is not connected.");
    }
    if (!session || !session.is_admin || !session.access_code) throw new Error("Admin sign-in is required.");
    const res = await fetch(`${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/admin_set_setting`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_admin_code: session.access_code, p_key: key, p_value: String(value || "").trim() })
    });
    if (!res.ok) throw new Error(`Failed saving setting (${res.status}): ${await res.text()}`);
  }

  // ---- Anonymous usage counts (no names, no patient data, no Listen transcripts) ----
  const Usage = (() => {
    const OPT_KEY = "usageOptOut";
    let queue = [];
    let timer = null;
    const optedOut = () => {
      try { if (localStorage.getItem(OPT_KEY) === "1") return true; } catch (_) { /* ignore */ }
      return navigator.doNotTrack === "1" || window.doNotTrack === "1";
    };
    const anonId = (store, key) => {
      try {
        let v = store.getItem(key);
        if (!v) {
          v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          store.setItem(key, v);
        }
        return v;
      } catch (_) { return null; }
    };
    const cleanTerm = (q) => {
      const t = String(q || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
      // never keep anything that looks like a phone number, ID or email
      if (!t || /\d{4,}/.test(t) || t.includes("@")) return null;
      return t;
    };
    async function flush() {
      timer = null;
      if (!queue.length) return;
      const cfg = window.APP_CONFIG || {};
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) { queue = []; return; }
      const batch = queue.splice(0, 40);
      try {
        await fetch(`${cfg.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/usage_events`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey: cfg.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
            Prefer: "return=minimal"
          },
          body: JSON.stringify(batch)
        });
      } catch (_) { /* usage counting must never disturb the app */ }
    }
    function log(event, detail) {
      try {
        if (optedOut() || !DB || !DB.isLive()) return;
        queue.push({
          event,
          detail: detail ? String(detail).slice(0, 60) : null,
          session_id: anonId(sessionStorage, "usageSid"),
          device_id: anonId(localStorage, "usageDid")
        });
        if (!timer) timer = setTimeout(flush, 8000);
      } catch (_) { /* ignore */ }
    }
    function openOnce() {
      try {
        if (sessionStorage.getItem("usageOpened") === "1") return;
        sessionStorage.setItem("usageOpened", "1");
      } catch (_) { /* ignore */ }
      log("app_open");
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return { log, openOnce, cleanTerm, optedOut, setOptOut(v) { try { localStorage.setItem(OPT_KEY, v ? "1" : "0"); } catch (_) { /* ignore */ } } };
  })();

  const isGlossary = (p) => p && p.entry_kind === "glossary";
  const clinicalPhrases = () => phrases.filter((p) => !isGlossary(p));

  let practiceSection = "ALL";
  let practiceDirection = "en_to_id";
  let practiceIndex = 0;
  let practiceStreak = 0;
  let practiceRevealed = false;

  let recordedDraft = null;
  let isRecording = false;
  let activeAudioEl = null;
  let noticeTimer = null;

  const $ = (id) => document.getElementById(id);

  async function syncDynamicAsrUrlFromDb() {
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) {
      return;
    }
    try {
      const url = `${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/app_settings?key=eq.idoma_asr_url&select=value`;
      const res = await fetch(url, {
        headers: {
          apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
        }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const val = Array.isArray(rows) && rows[0]?.value ? String(rows[0].value).trim() : "";
      if (val) {
        window.APP_CONFIG.DYNAMIC_ASR_URL = val;
      }
    } catch {
      // Ignore if app_settings table is not created yet
    }
  }

  async function saveDynamicAsrUrlToDb(newUrl) {
    const clean = String(newUrl || "").trim();
    if (!DB || !DB.isLive() || !window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_ANON_KEY) {
      throw new Error("Supabase is not connected.");
    }
    if (!session || !session.is_admin || !session.access_code) {
      throw new Error("Admin sign-in is required to update the live ASR URL.");
    }

    const endpoint = `${window.APP_CONFIG.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/admin_set_setting`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.APP_CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${window.APP_CONFIG.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        p_admin_code: session.access_code,
        p_key: "idoma_asr_url",
        p_value: clean
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed saving ASR URL (${res.status}): ${body}`);
    }
    window.APP_CONFIG.DYNAMIC_ASR_URL = clean;
  }

  function setStatusBanner(msg, type = "info") {
    const el = $("systemNotice");
    if (!el) return;
    if (noticeTimer) clearTimeout(noticeTimer);

    el.hidden = false;
    el.className = `notice-banner notice-${type}`;
    el.style.position = "fixed";
    el.style.bottom = "18px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.width = "min(560px, calc(100vw - 24px))";
    el.style.zIndex = "9999";
    el.style.boxShadow = "0 10px 28px rgba(16, 42, 34, 0.25)";

    el.innerHTML = `
      <span>${escapeHtml(msg)}</span>
      <button type="button" class="notice-close-btn" aria-label="Dismiss notification">×</button>
    `;
    el.querySelector(".notice-close-btn")?.addEventListener("click", () => {
      el.hidden = true;
    });

    noticeTimer = setTimeout(() => {
      el.hidden = true;
    }, 6000);
  }

  function renderContributorQuickBar() {
    const mainWrap = document.querySelector(".main-wrap");
    if (!mainWrap) return;
    let bar = $("contributorQuickBar");

    if (!session) {
      if (bar) bar.hidden = true;
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = "contributorQuickBar";
      bar.className = "guest-auth-callout";
      bar.style.borderColor = "var(--accent)";
      mainWrap.prepend(bar);
    }

    bar.hidden = false;
    bar.innerHTML = `
      <span><strong>Signed in as ${escapeHtml(session.full_name)}</strong> · Quick actions:</span>
      <div class="btn-row" style="margin-top:0; gap:6px;">
        <button type="button" class="btn btn-sm btn-primary" id="qbAddPhraseBtn">+ Add Phrase / Variant</button>
        <button type="button" class="btn btn-sm btn-secondary" id="qbRecordAudioBtn">Record Audio</button>
        ${session.is_admin ? `<button type="button" class="btn btn-sm btn-secondary" id="qbAdminQueueBtn">Moderation Queue</button>` : ""}
      </div>
    `;

    $("qbAddPhraseBtn")?.addEventListener("click", () => {
      switchTab("contributeTab");
      if ($("subType")) {
        $("subType").value = "new_phrase";
        toggleSubFormMode();
      }
      $("subEnglish")?.focus();
    });

    $("qbRecordAudioBtn")?.addEventListener("click", () => {
      switchTab("contributeTab");
      const recBtn = $("recordToggleBtn");
      recBtn?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => recBtn?.focus(), 200);
    });

    $("qbAdminQueueBtn")?.addEventListener("click", () => {
      switchTab("adminTab");
    });
  }

  function renderGuideToneExamples() {
    const wrap = $("guideToneExamples");
    if (!wrap) return;
    const withTone = phrases
      .filter((p) => p.status === "verified" && p.tone && (p.idoma || p.alala))
      .slice(0, 4);

    if (withTone.length === 0) {
      wrap.innerHTML = `<div class="tone-alert" style="margin-top:0;">Verified tone-contrast notes added by native reviewers will appear here automatically.</div>`;
      return;
    }

    wrap.innerHTML = withTone.map((p) => `
      <div class="tone-alert" style="margin-top:0;">
        <strong>${escapeHtml(p.idoma || p.alala)}</strong> (${escapeHtml(p.english)}) — ${escapeHtml(p.tone)}
      </div>
    `).join("");
  }

  function renderSessionUI() {
    const headerAuthBox = $("headerAuthBox");
    const loginForm = $("loginForm");
    const sessionRow = $("sessionRow");
    const sessionStatus = $("sessionStatus");
    const adminTab = document.querySelector('[data-tab="adminTab"]');

    if (session) {
      if (headerAuthBox) headerAuthBox.hidden = false;
      if (loginForm) loginForm.hidden = true;
      if (sessionRow) sessionRow.hidden = false;
      if (sessionStatus) {
        sessionStatus.textContent = `${session.full_name} (${session.is_admin ? "Admin" : session.role_title})`;
      }
      if (adminTab) adminTab.hidden = !session.is_admin;
    } else {
      if (loginForm) loginForm.hidden = true;
      if (sessionRow) sessionRow.hidden = true;
      if (headerAuthBox) headerAuthBox.hidden = true;
      if (adminTab) adminTab.hidden = true;
    }
    renderContributorQuickBar();
    renderContributeGuestNotice();
    renderPhrases();
  }

  function openLoginBox() {
    if (session) {
      renderSessionUI();
      return;
    }
    const headerAuthBox = $("headerAuthBox");
    const loginForm = $("loginForm");
    const sessionRow = $("sessionRow");
    if (headerAuthBox) headerAuthBox.hidden = false;
    if (sessionRow) sessionRow.hidden = true;
    if (loginForm) loginForm.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => $("accessCodeInput")?.focus(), 120);
  }

  function openVolunteerForm() {
    switchTab("contributeTab");
    const subType = $("subType");
    if (subType) {
      subType.value = "volunteer_request";
      toggleSubFormMode();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => $("volName")?.focus(), 120);
  }

  function toggleSubFormMode() {
    const type = $("subType")?.value || "term_request";
    const isVol = type === "volunteer_request";
    const volBox = $("volunteerFieldsBox");
    const phraseBox = $("phraseFieldsBox");
    const submitBtn = $("subSubmitBtn");

    if (volBox) volBox.hidden = !isVol;
    if (phraseBox) phraseBox.hidden = isVol;
    if (submitBtn) {
      submitBtn.textContent = isVol ? "Submit Volunteer Application" : "Submit Entry";
    }
  }

  function renderContributeGuestNotice() {
    const tabEl = $("contributeTab");
    if (!tabEl) return;
    let notice = $("contributeGuestNotice");
    if (session) {
      if (notice) notice.hidden = true;
      return;
    }
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "contributeGuestNotice";
      notice.className = "guest-auth-callout";
      notice.innerHTML = `
        <span><strong>Guest mode:</strong> Request missing clinical terms or apply to volunteer freely. Already have a contributor code?</span>
        <button type="button" class="btn btn-sm btn-secondary" id="openLoginFromContributeBtn">Contributor Sign In</button>
      `;
      tabEl.prepend(notice);
      $("openLoginFromContributeBtn")?.addEventListener("click", openLoginBox);
    }
    notice.hidden = false;
  }

  function renderSectionPills() {
    const wrap = $("sectionPills");
    if (!wrap) return;
    const sections = ["ALL", ...Array.from(new Set(clinicalPhrases().map((p) => p.section).filter(Boolean)))];
    wrap.innerHTML = sections.map((sec) => {
      const label = sec === "ALL" ? `All (${clinicalPhrases().length})` : sec;
      const isActive = activeSection === sec;
      return `<button type="button" class="sec-pill ${isActive ? "active" : ""}" data-sec-pill="${escapeHtml(sec)}">${escapeHtml(label)}</button>`;
    }).join("");

    wrap.querySelectorAll("[data-sec-pill]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSection = btn.getAttribute("data-sec-pill");
        renderSectionPills();
        renderPhrases();
      });
    });
  }

  function getFilteredPhrases() {
    const q = ($("searchInput")?.value || "").trim();
    const basePool = clinicalPhrases().filter((p) => {
      if (activeSection !== "ALL" && p.section !== activeSection) return false;
      if (activeStatus !== "ALL" && p.status !== activeStatus) return false;
      if (dialectOnly && !p.alala && !p.variationLabel) return false;
      return true;
    });

    if (!q) {
      return basePool.map((p) => ({ ...p, _matchedVia: null }));
    }

    if (window.ClinicalSearch) {
      const main = window.ClinicalSearch.searchAndRank(basePool, q).map((item) => ({
        ...item.phrase,
        _matchedVia: item.matchedVia
      }));
      // Glossary entries only surface when searching, never on the default list
      let gloss = [];
      if (activeSection === "ALL" && !dialectOnly) {
        const gPool = phrases.filter((p) => isGlossary(p) && (activeStatus === "ALL" || p.status === activeStatus));
        gloss = window.ClinicalSearch.searchAndRank(gPool, q).slice(0, 30).map((item) => ({
          ...item.phrase,
          _matchedVia: item.matchedVia,
          _glossary: true
        }));
      }
      return main.concat(gloss);
    }

    const low = q.toLowerCase();
    return basePool
      .filter((p) =>
        [p.english, p.idoma, p.alala, p.variationLabel, p.syllables, p.phonetic, p.tone, p.clinical, p.section, p.subsection]
          .join(" ")
          .toLowerCase()
          .includes(low)
      )
      .map((p) => ({ ...p, _matchedVia: null }));
  }

  function statusBadgeHtml(status) {
    if (status === "verified") return `<span class="badge badge-verified">Verified</span>`;
    if (status === "missing") return `<span class="badge badge-missing">Pending / Blank</span>`;
    return `<span class="badge badge-unconfirmed">Unconfirmed (?)</span>`;
  }

  function createCardHtml(p) {
    const clip = audioMap[p.id];
    const isPinned = trayIds.has(String(p.id));
    const audioBtn = clip && clip.url
      ? `<button type="button" class="btn btn-sm btn-primary" data-play-url="${escapeHtml(clip.url)}" data-play-phrase="${escapeHtml(p.id)}">Play Audio</button>`
      : `<span class="muted small-note">No audio yet</span>`;

    const variantTag = p.variationLabel || alalaLabel;

    return `
      <article class="phrase-card status-${escapeHtml(p.status)} ${bedsideMode ? "bedside-card" : ""}">
        <div>
          <div class="card-top">
            <span class="sec-tag">${escapeHtml(p.section)}${p.subsection ? " · " + escapeHtml(p.subsection) : ""}</span>
            ${statusBadgeHtml(p.status)}
          </div>
          ${p._matchedVia ? `<div class="muted small-note" style="margin-bottom:4px;">Matched via synonym/spelling: <strong>${escapeHtml(p._matchedVia)}</strong></div>` : ""}
          ${p.variation_of_id && isGlossary(p) ? (() => { const base = phrases.find((x) => String(x.id) === String(p.variation_of_id)); return base ? `<div class="muted small-note" style="margin-bottom:4px;">Variant of: <strong>${escapeHtml(base.english)}</strong>${base.idoma ? " (" + escapeHtml(base.idoma) + ")" : ""}</div>` : ""; })() : ""}
          <h3 class="english-term">${escapeHtml(p.english)}</h3>
          <div class="idoma-row">
            <span class="idoma-term">${p.idoma ? escapeHtml(p.idoma) : "<em>No general Idoma entry yet</em>"}</span>
            ${audioBtn}
          </div>
          ${p.alala ? `
            <div class="alala-row">
              <span class="alala-tag">${escapeHtml(variantTag)}</span>
              <strong>${escapeHtml(p.alala)}</strong>
            </div>
          ` : ""}
          ${p.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(p.syllables)}</code></div>` : ""}
          ${p.phonetic ? `<div class="meta-line"><strong>Pronunciation:</strong> ${escapeHtml(p.phonetic)}</div>` : ""}
          ${p.tone ? `<div class="tone-alert"><strong>Tone / Pitch:</strong> ${escapeHtml(p.tone)}</div>` : ""}
          ${p.clinical ? `<div class="clinical-note"><strong>Note:</strong> ${escapeHtml(p.clinical)}</div>` : ""}
        </div>
        <div class="card-actions">
          <button type="button" class="btn btn-sm ${isPinned ? "btn-pinned" : "btn-secondary"}" data-pin-id="${escapeHtml(p.id)}">
            ${isPinned ? "Pinned in Tray" : "+ Pin to Tray"}
          </button>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${session ? `<button type="button" class="btn btn-sm btn-secondary" data-record-phrase="${escapeHtml(p.id)}">Record Audio</button>` : ""}
            <button type="button" class="btn btn-sm btn-ghost" data-suggest-edit="${escapeHtml(p.id)}">Edit</button>
            ${session && session.is_admin ? `<button type="button" class="btn btn-sm btn-ghost" data-hide-phrase="${escapeHtml(p.id)}">Hide</button><button type="button" class="btn btn-sm btn-ghost" data-delete-phrase="${escapeHtml(p.id)}" style="color:#b91c1c;">Delete</button>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function bindCardInteractions(container) {
    container.querySelectorAll("[data-play-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-play-url");
        const played = phrases.find((x) => String(x.id) === String(btn.getAttribute("data-play-phrase")));
        Usage.log("audio_played", played ? (played.code || null) : null);
        if (activeAudioEl) activeAudioEl.pause();
        activeAudioEl = new Audio(url);
        activeAudioEl.play().catch((e) => setStatusBanner("Could not play audio: " + e.message, "warn"));
      });
    });

    container.querySelectorAll("[data-pin-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-pin-id"));
        if (trayIds.has(id)) {
          trayIds.delete(id);
        } else {
          trayIds.add(id);
          const pinned = phrases.find((x) => String(x.id) === id);
          Usage.log("phrase_pinned", pinned ? (pinned.code || null) : null);
        }
        DB.saveTrayIds(trayIds);
        updateTrayBadge();
        renderPhrases();
        renderTray();
      });
    });

    container.querySelectorAll("[data-record-phrase]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-record-phrase"));
        switchTab("contributeTab");
        if ($("audioPhraseSelect")) $("audioPhraseSelect").value = id;
        const recBtn = $("recordToggleBtn");
        recBtn?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => recBtn?.focus(), 200);
      });
    });

    container.querySelectorAll("[data-hide-phrase]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = String(btn.getAttribute("data-hide-phrase"));
        const target = phrases.find((x) => String(x.id) === id);
        if (!target) return;
        if (!confirm(`Hide "${target.english}" from the app?\n\nYou can restore it later from Admin Studio, under Hidden terms.`)) return;
        try {
          await DB.adminSetPhrasePublished(session, id, false);
          await refreshPhrasesFromDb();
          setStatusBanner("Term hidden. Restore it from Admin Studio, under Hidden terms.", "success");
        } catch (err) {
          setStatusBanner("Could not hide term: " + err.message, "warn");
        }
      });
    });

    container.querySelectorAll("[data-delete-phrase]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = String(btn.getAttribute("data-delete-phrase"));
        const target = phrases.find((x) => String(x.id) === id);
        if (!target) return;
        if (!confirm(`Permanently delete "${target.english}"?\n\nThis also removes its audio recordings from the app and cannot be undone. Choose Hide instead if you might want it back.`)) return;
        try {
          await DB.adminDeletePhrase(session, id);
          await refreshPhrasesFromDb();
          setStatusBanner("Term deleted.", "success");
        } catch (err) {
          setStatusBanner("Could not delete term: " + err.message, "warn");
        }
      });
    });

    container.querySelectorAll("[data-suggest-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-suggest-edit"));
        const target = phrases.find((x) => String(x.id) === id);
        if (!target) return;
        switchTab("contributeTab");
        $("subType").value = "edit_phrase";
        toggleSubFormMode();
        $("subTargetId").value = target.id;
        $("subSection").value = target.section;
        $("subSubsection").value = target.subsection || "";
        $("subEnglish").value = target.english;
        $("subIdoma").value = target.idoma || "";
        if ($("subAlala")) $("subAlala").value = target.alala || "";
        $("subSyllables").value = target.syllables || "";
        $("subPhonetic").value = target.phonetic || "";
        $("subTone").value = target.tone || "";
        $("subClinical").value = target.clinical || "";
        $("audioPhraseSelect").value = target.id;
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function renderPhrases() {
    const listEl = $("phraseList");
    const fallbackEl = $("fallbackBox");
    const countEl = $("resultCount");
    if (!listEl) return;

    const q = ($("searchInput")?.value || "").trim();
    const filtered = getFilteredPhrases();
    const clinicalHits = filtered.filter((p) => !p._glossary);
    const glossHits = filtered.filter((p) => p._glossary);
    if (countEl) {
      countEl.textContent = `Showing ${clinicalHits.length} of ${clinicalPhrases().length} clinical entries`
        + (glossHits.length ? ` + ${glossHits.length} from the Common Terms Glossary` : "");
    }

    if (filtered.length === 0) {
      listEl.innerHTML = "";
      if (fallbackEl) {
        fallbackEl.hidden = false;
        const keywords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const related = phrases
          .filter((p) => (p.idoma || p.alala) && keywords.some((w) => (p.english + " " + p.clinical + " " + p.section).toLowerCase().includes(w)))
          .slice(0, 4);

        fallbackEl.innerHTML = `
          <h3>Exact translation not found in verified glossary</h3>
          <p class="small-note">Written spelling alone cannot capture Idoma tone, so we do not guess unverified translations. Request this term below or check related entries:</p>
          ${related.length
            ? `<div class="related-list">${related.map((r) => `<button type="button" class="chip-btn" data-jump-phrase="${escapeHtml(r.english)}">${escapeHtml(r.english)} → <strong>${escapeHtml(r.idoma || r.alala)}</strong></button>`).join("")}</div>`
            : `<p class="muted small-note">No close keyword matches found.</p>`}
          <button type="button" class="btn btn-primary btn-sm" id="openRequestFromFallback">Request "${escapeHtml(q || "Missing Term")}"</button>
        `;
        $("openRequestFromFallback")?.addEventListener("click", () => {
          if ($("subEnglish")) $("subEnglish").value = q;
          if ($("subType")) {
            $("subType").value = "term_request";
            toggleSubFormMode();
          }
          switchTab("contributeTab");
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        fallbackEl.querySelectorAll("[data-jump-phrase]").forEach((btn) => {
          btn.addEventListener("click", () => {
            $("searchInput").value = btn.getAttribute("data-jump-phrase");
            renderPhrases();
          });
        });
      }
      return;
    }

    if (fallbackEl) fallbackEl.hidden = true;
    listEl.innerHTML = clinicalHits.map(createCardHtml).join("")
      + (glossHits.length
        ? `<div class="muted small-note" style="grid-column:1/-1; margin:14px 0 4px; padding-top:10px; border-top:1px solid var(--border, #dce5e1);">
             <strong>From the Common Terms Glossary</strong> · everyday vocabulary, spelling is a guide only. Verify aloud with a native speaker.
           </div>` + glossHits.map(createCardHtml).join("")
        : "");
    bindCardInteractions(listEl);
  }

  function updateTrayBadge() {
    const badge = $("trayCountBadge");
    if (badge) badge.textContent = trayIds.size;
  }

  function renderTray() {
    const trayList = $("trayList");
    const emptyState = $("trayEmptyState");
    if (!trayList) return;

    const pinned = phrases.filter((p) => trayIds.has(String(p.id)));
    if (pinned.length === 0) {
      trayList.innerHTML = "";
      if (emptyState) emptyState.hidden = false;
      return;
    }
    if (emptyState) emptyState.hidden = true;
    trayList.innerHTML = pinned.map(createCardHtml).join("");
    bindCardInteractions(trayList);
  }

  function renderPracticeCard() {
    const cardEl = $("practiceCard");
    if (!cardEl) return;

    const translated = clinicalPhrases().filter((p) => (p.idoma || p.alala) && p.status !== "missing");
    const sections = Array.from(new Set(translated.map((p) => p.section).filter(Boolean)));
    const pool = practiceSection === "ALL"
      ? translated
      : translated.filter((p) => p.section === practiceSection);

    const directionLabel = practiceDirection === "en_to_id"
      ? "English → Idoma"
      : "Idoma → English";

    const controlsHtml = `
      <div class="practice-controls">
        <select id="practiceSectionSelect" aria-label="Filter practice cards by section" style="max-width:240px;">
          <option value="ALL">All Sections (${translated.length})</option>
          ${sections.map((s) => `<option value="${escapeHtml(s)}" ${s === practiceSection ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-sm btn-secondary" id="toggleDirectionBtn">${directionLabel}</button>
      </div>
    `;

    if (pool.length === 0) {
      cardEl.innerHTML = `${controlsHtml}<p class="muted">No translated phrases available for this section yet.</p>`;
      return;
    }

    const item = pool[practiceIndex % pool.length];
    const clip = audioMap[item.id];
    const isReverse = practiceDirection === "id_to_en";

    const variantTag = item.variationLabel || alalaLabel;
    const primaryIdoma = item.idoma || `${item.alala} (${variantTag})`;
    const promptText = isReverse ? primaryIdoma : item.english;
    const answerText = isReverse ? item.english : primaryIdoma;

    cardEl.innerHTML = `
      <div class="practice-meta">
        ${controlsHtml}
        <span>Card ${(practiceIndex % pool.length) + 1} of ${pool.length} · Streak: <strong>${practiceStreak}</strong></span>
      </div>
      <div class="sec-tag">${escapeHtml(item.section)}${item.subsection ? " · " + escapeHtml(item.subsection) : ""}</div>
      <h3 class="english-term" style="font-size:1.35rem;">${escapeHtml(promptText)}</h3>
      ${isReverse && item.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(item.syllables)}</code></div>` : ""}
      ${practiceRevealed ? `
        <div class="reveal-box">
          <div class="idoma-term" style="font-size:1.25rem;">${escapeHtml(answerText)}</div>
          ${item.idoma && item.alala ? `<div class="alala-row" style="margin-top:8px;"><span class="alala-tag">${escapeHtml(variantTag)}</span><strong>${escapeHtml(item.alala)}</strong></div>` : ""}
          ${!isReverse && item.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(item.syllables)}</code></div>` : ""}
          ${item.phonetic ? `<div class="meta-line"><strong>Pronunciation:</strong> ${escapeHtml(item.phonetic)}</div>` : ""}
          ${item.tone ? `<div class="tone-alert">${escapeHtml(item.tone)}</div>` : ""}
          ${item.clinical ? `<div class="clinical-note">${escapeHtml(item.clinical)}</div>` : ""}
          ${clip && clip.url ? `<div class="card-actions"><button type="button" class="btn btn-sm btn-primary" id="practicePlayAudio">Play Approved Audio</button></div>` : ""}
        </div>
        <div class="practice-buttons">
          <button type="button" class="btn btn-primary" id="markRecalledBtn">Recalled Well (+1 Streak)</button>
          <button type="button" class="btn btn-secondary" id="needsReviewBtn">Needs Review</button>
          <button type="button" class="btn btn-ghost" id="shufflePracticeBtn">Random Card</button>
        </div>
      ` : `
        <div class="practice-buttons">
          <button type="button" class="btn btn-primary" id="revealAnswerBtn">Reveal Answer</button>
          <button type="button" class="btn btn-ghost" id="shufflePracticeBtn">Random Card</button>
        </div>
      `}
    `;

    $("practiceSectionSelect")?.addEventListener("change", (e) => {
      practiceSection = e.target.value;
      practiceIndex = 0;
      practiceRevealed = false;
      renderPracticeCard();
    });
    $("toggleDirectionBtn")?.addEventListener("click", () => {
      practiceDirection = practiceDirection === "en_to_id" ? "id_to_en" : "en_to_id";
      practiceRevealed = false;
      renderPracticeCard();
    });
    $("revealAnswerBtn")?.addEventListener("click", () => {
      practiceRevealed = true;
      renderPracticeCard();
    });
    $("practicePlayAudio")?.addEventListener("click", () => {
      if (clip && clip.url) new Audio(clip.url).play().catch(() => {});
    });
    $("markRecalledBtn")?.addEventListener("click", () => {
      practiceStreak += 1;
      practiceIndex += 1;
      practiceRevealed = false;
      renderPracticeCard();
    });
    $("needsReviewBtn")?.addEventListener("click", () => {
      practiceStreak = 0;
      practiceIndex += 1;
      practiceRevealed = false;
      renderPracticeCard();
    });
    $("shufflePracticeBtn")?.addEventListener("click", () => {
      if (pool.length > 1) {
        let next = Math.floor(Math.random() * pool.length);
        if (next === (practiceIndex % pool.length)) next = (next + 1) % pool.length;
        practiceIndex = next;
      }
      practiceRevealed = false;
      renderPracticeCard();
    });
  }

  function renderCredits() {
    const el = $("creditsGrid");
    if (!el) return;
    if (!credits || credits.length === 0) {
      el.innerHTML = "<p class='muted'>No public credits listed yet.</p>";
      return;
    }
    el.innerHTML = credits.map((c) => `
      <div class="credit-card">
        <strong>${escapeHtml(c.full_name)}</strong>
        <span class="role-pill">${escapeHtml(c.role_title)}</span>
        ${c.notes ? `<p class="muted small-note" style="margin-bottom:0;">${escapeHtml(c.notes)}</p>` : ""}
      </div>
    `).join("");
  }

  function populateAudioPhraseSelect() {
    const sel = $("audioPhraseSelect");
    if (!sel) return;
    const prev = sel.value;
    const text = normalizeForFilter($("audioPhraseFilter")?.value || "");
    const kind = $("audioKindFilter")?.value || "all";
    const needsOnly = !!$("audioNeedsOnly")?.checked;
    const keep = (p) => {
      if (kind === "clinical" && isGlossary(p)) return false;
      if (kind === "glossary" && !isGlossary(p)) return false;
      if (needsOnly && audioMap[p.id]) return false;
      if (text && !normalizeForFilter(`${p.english} ${p.idoma || ""} ${p.alala || ""}`).includes(text)) return false;
      return true;
    };
    const optionHtml = (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.english)}${p.idoma ? " — " + escapeHtml(p.idoma) : (p.alala ? " — " + escapeHtml(p.alala) + " (Variant)" : " [Blank]")}${audioMap[p.id] ? " ✓" : ""}</option>`;
    const clinical = clinicalPhrases().filter(keep);
    const glossary = phrases.filter((p) => isGlossary(p) && keep(p));
    sel.innerHTML = clinical.map(optionHtml).join("")
      + (glossary.length ? `<optgroup label="Common Terms Glossary">${glossary.map(optionHtml).join("")}</optgroup>` : "");
    if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    const info = $("audioFilterInfo");
    if (info) info.textContent = `${clinical.length + glossary.length} matching`;
  }

  async function renderAdminDashboard() {
    const container = $("adminContent");
    if (!container) return;
    if (!session || !session.is_admin) {
      container.innerHTML = "<p class='muted'>Sign in with an Admin access code to manage contributors, submissions, and audio clips.</p>";
      return;
    }

    container.innerHTML = "<p class='muted'>Loading moderation queues...</p>";
    try {
      const data = await DB.adminGetData(session);
      const liveDbCount = DB.isLive() ? clinicalPhrases().length : 0;
      const isSynced = DB.isLive() && liveDbCount >= seedPhrases.length && seedPhrases.length > 0;
      const pendingAll = data.submissions.filter((s) => s.review_status === "pending");
      const pendingVols = pendingAll.filter((s) => s.section === "Volunteer Application" || s.submission_type === "volunteer_request");
      const pendingSubs = pendingAll.filter((s) => s.section !== "Volunteer Application" && s.submission_type !== "volunteer_request");
      const pendingAudio = data.audioClips.filter((a) => a.approval_status === "pending");
      const approvedAudioCount = data.audioClips.filter((c) => c.approval_status === "approved").length;
      const currentAsrUrl = window.APP_CONFIG?.DYNAMIC_ASR_URL || window.APP_CONFIG?.IDOMA_ASR_URL || "";

      container.innerHTML = `
        <div class="panel" style="margin-bottom:16px;">
          <div class="panel-header-row">
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h3 style="margin:0;">Database Seed Sync</h3>
                <span class="badge ${isSynced ? "badge-verified" : "badge-unconfirmed"}">
                  ${DB.isLive() ? `Live Supabase: ${liveDbCount} entries · Seed JSON: ${seedPhrases.length}` : "Offline / Demo Mode"}
                </span>
              </div>
              <p class="muted small-note" style="margin-top:6px;">
                ${isSynced
                  ? "Your live Supabase database is up to date with seed-phrases.json. Re-run anytime you add new entries to the JSON file."
                  : "Import entries from data/seed-phrases.json into your live Supabase table so contributors can attach audio clips and edits."}
              </p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="exportDatasetBtn">
                Export Speech Dataset (${approvedAudioCount} clips)
              </button>
              <button type="button" class="btn ${isSynced ? "btn-secondary" : "btn-primary"}" id="importSeedBtn">
                ${isSynced ? "Re-Sync Seed JSON" : "Import Seed JSON to DB"}
              </button>
            </div>
          </div>
          <p id="importSeedProgress" class="small-note muted" style="margin:8px 0 0;"></p>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1); display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
            <label style="flex:1; min-width:220px; margin:0;">
              Live Cloud ASR URL (Colab / Gradio)
              <input type="url" id="liveAsrUrlInput" value="${escapeHtml(currentAsrUrl)}" placeholder="https://xxxx.gradio.live" />
            </label>
            <button type="button" class="btn btn-secondary" id="saveLiveAsrUrlBtn">Save ASR URL</button>
          </div>

          <div style="margin-top:6px;">
            <strong>Stats</strong>
            <div style="margin-top:8px;">
              <button type="button" class="btn btn-secondary" id="loadStatsBtn">Load stats</button>
            </div>
            <div id="adminStatsBox" style="margin-top:8px;"></div>
          </div>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1);">
            <strong>Common Terms Glossary</strong>
            <p class="muted small-note" style="margin:6px 0 8px;">
              Import a lexicon .json file. Entries stay off the home list and only appear in search results.
              Terms identical to an existing one are skipped; different spellings of an existing term are added as variants.
              Safe to re-run.
            </p>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <input type="file" id="glossaryFileInput" accept="application/json,.json" />
              <button type="button" class="btn btn-secondary" id="importGlossaryBtn">Import Glossary JSON</button>
            </div>
            <p id="glossaryImportStatus" class="small-note muted" style="margin:8px 0 0;"></p>
          </div>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1);">
            <strong>Dialects</strong>
            <p class="muted small-note" style="margin:6px 0 8px;">
              Names used in the recorder, audio labels and cards. Rename a dialect, change its order, or hide it. A code can't change once created.
              Confirm preferred names with community speakers first.
            </p>
            <div id="dialectAdminBox"><p class="muted small-note">Loading...</p></div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px;">
              <input type="text" id="newDialectCode" maxlength="24" placeholder="code, e.g. enone" style="width:130px;" />
              <input type="text" id="newDialectLabel" maxlength="60" placeholder="Label, e.g. Enone (Orokam)" style="flex:1; min-width:180px;" />
              <button type="button" class="btn btn-secondary" id="addDialectBtn">Add dialect</button>
            </div>
          </div>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1);">
            <strong>Hidden terms</strong>
            <p class="muted small-note" style="margin:6px 0 8px;">Terms you hid with the Hide button on a card. Restore them here.</p>
            <button type="button" class="btn btn-secondary" id="loadHiddenBtn">Show hidden terms</button>
            <div id="hiddenTermsBox" style="margin-top:8px;"></div>
          </div>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1);">
            <strong>Special acknowledgments</strong>
            <p class="muted small-note" style="margin:6px 0 8px;">One name or group per line. Shown under Guide &amp; Credits. Leave blank to restore the default list.</p>
            <textarea id="ackInput" rows="7" style="width:100%;">${escapeHtml(specialAck.join("\n"))}</textarea>
            <div style="margin-top:8px;">
              <button type="button" class="btn btn-secondary" id="saveAckBtn">Save acknowledgments</button>
            </div>
          </div>

          <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border, #dce5e1);">
            <strong>Feedback inbox</strong>
            <div style="margin-top:8px;">
              <button type="button" class="btn btn-secondary" id="loadFeedbackBtn">Load latest feedback</button>
            </div>
            <div id="feedbackInbox" style="margin-top:8px;"></div>
          </div>
        </div>

        <div class="admin-grid">
          <section class="panel">
            <h3>1. Contributors, Access Codes & Credits</h3>
            <form id="contribForm" class="stack-form">
              <input type="hidden" id="cId" />
              <div class="two-col">
                <label>Full Name <input type="text" id="cName" required placeholder="e.g. Peace Onogwu" /></label>
                <label>Role Title <input type="text" id="cRole" required placeholder="e.g. Alala (Orokam) translation" /></label>
              </div>
              <div class="two-col">
                <label>Access Code <input type="text" id="cCode" required placeholder="e.g. CONT-PEACE-01" /></label>
                <label>Notes <input type="text" id="cNotes" placeholder="Dialect / specialty notes" /></label>
              </div>
              <div class="two-col">
                <label>Daily Phrase Limit <input type="number" id="cSubLimit" value="50" min="1" max="500" /></label>
                <label>Daily Audio Limit <input type="number" id="cAudLimit" value="50" min="1" max="500" /></label>
              </div>
              <div class="checkbox-row">
                <label><input type="checkbox" id="cIsAdmin" /> Admin Role</label>
                <label><input type="checkbox" id="cShowCredits" checked /> Show in Credits</label>
                <label><input type="checkbox" id="cIsActive" checked /> Active</label>
              </div>
              <div class="btn-row">
                <button type="submit" class="btn btn-primary">Save Contributor</button>
                <button type="button" class="btn btn-ghost" id="cResetBtn">Clear Form</button>
              </div>
            </form>

            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr><th>Name</th><th>Role</th><th>Code</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  ${data.contributors.map((c) => `
                    <tr>
                      <td><strong>${escapeHtml(c.full_name)}</strong>${c.is_admin ? " <span class='badge badge-verified'>Admin</span>" : ""}</td>
                      <td>${escapeHtml(c.role_title)}</td>
                      <td><code>${escapeHtml(c.access_code)}</code></td>
                      <td>
                        <button type="button" class="btn btn-sm btn-ghost" data-edit-c="${escapeHtml(c.id)}">Edit</button>
                        <button type="button" class="btn btn-sm btn-danger" data-del-c="${escapeHtml(c.id)}">Remove</button>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <h3>2. Volunteer Applications (${pendingVols.length})</h3>
            ${pendingVols.length === 0 ? "<p class='muted small-note'>No pending volunteer applications.</p>" : pendingVols.map((v) => `
              <div class="mod-item">
                <div class="card-top">
                  <span class="sec-tag">Volunteer Request</span>
                  <span class="muted small-note">${escapeHtml(v.requester_label || "")}</span>
                </div>
                <strong>Applicant:</strong> ${escapeHtml(v.english_term)}<br/>
                ${v.alala_term ? `<strong>Dialects:</strong> ${escapeHtml(v.alala_term)}<br/>` : ""}
                ${v.clinical_note ? `<strong>Details:</strong> ${escapeHtml(v.clinical_note)}<br/>` : ""}
                <div class="btn-row">
                  <button type="button" class="btn btn-sm btn-primary" data-prefill-vol="${escapeHtml(v.id)}">Issue Code in Form</button>
                  <button type="button" class="btn btn-sm btn-secondary" data-sub-action="approved" data-sub-id="${escapeHtml(v.id)}">Mark Handled</button>
                  <button type="button" class="btn btn-sm btn-danger" data-sub-action="rejected" data-sub-id="${escapeHtml(v.id)}">Decline</button>
                </div>
              </div>
            `).join("")}

            <h3 class="mt-lg">3. Pending Phrase Edits & Term Requests (${pendingSubs.length})</h3>
            ${pendingSubs.length === 0 ? "<p class='muted small-note'>No pending phrase submissions.</p>" : pendingSubs.map((s) => `
              <div class="mod-item">
                <div class="card-top">
                  <span class="sec-tag">${escapeHtml(s.submission_type)} · ${escapeHtml(s.section)}</span>
                  <span class="muted small-note">By ${escapeHtml(s.requester_label || "User")}</span>
                </div>
                <strong>English:</strong> ${escapeHtml(s.english_term)}<br/>
                ${s.idoma_term ? `<strong>Idoma:</strong> ${escapeHtml(s.idoma_term)}<br/>` : ""}
                ${s.alala_term ? `<strong>Dialect Variant:</strong> ${escapeHtml(s.alala_term)}<br/>` : ""}
                ${s.clinical_note ? `<strong>Notes:</strong> ${escapeHtml(s.clinical_note)}<br/>` : ""}
                <div class="btn-row">
                  <button type="button" class="btn btn-sm btn-primary" data-sub-action="approved" data-sub-id="${escapeHtml(s.id)}">Approve & Publish</button>
                  <button type="button" class="btn btn-sm btn-danger" data-sub-action="rejected" data-sub-id="${escapeHtml(s.id)}">Reject</button>
                </div>
              </div>
            `).join("")}

            <h3 class="mt-lg">4. Pending Audio Clips (${pendingAudio.length})</h3>
            ${pendingAudio.length === 0 ? "<p class='muted small-note'>No pending voice clips.</p>" : pendingAudio.map((a) => {
              const phrase = phrases.find((p) => String(p.id) === String(a.phrase_id));
              let src = a.data_url || "";
              if (!src && DB.isLive() && window.APP_CONFIG?.SUPABASE_URL) {
                const bucket = window.APP_CONFIG.AUDIO_BUCKET || "idoma-audio";
                src = `${window.APP_CONFIG.SUPABASE_URL}/storage/v1/object/public/${bucket}/${a.storage_path}`;
              }
              return `
                <div class="mod-item">
                  <strong>Phrase:</strong> ${escapeHtml(phrase ? phrase.english : a.phrase_id)}<br/>
                  ${a.dialect ? `<strong>Dialect:</strong> ${escapeHtml(dialectLabelFor(a.dialect))}<br/>` : ""}
                  ${a.spoken_text ? `<strong>Written as:</strong> ${escapeHtml(a.spoken_text)}<br/>` : "<em>No written text saved.</em><br/>"}
                  ${a.dialect_note ? `<strong>Dialect note:</strong> ${escapeHtml(a.dialect_note)}<br/>` : ""}
                  ${src ? `<audio controls src="${escapeHtml(src)}" class="audio-player"></audio>` : ""}
                  <div class="btn-row">
                    <button type="button" class="btn btn-sm btn-primary" data-aud-action="approved" data-aud-id="${escapeHtml(a.id)}">Approve Live Audio</button>
                    <button type="button" class="btn btn-sm btn-danger" data-aud-action="rejected" data-aud-id="${escapeHtml(a.id)}">Reject</button>
                  </div>
                </div>
              `;
            }).join("")}
          </section>
        </div>
      `;

      $("saveLiveAsrUrlBtn")?.addEventListener("click", async () => {
        const input = $("liveAsrUrlInput");
        const btn = $("saveLiveAsrUrlBtn");
        if (!input) return;
        if (btn) btn.disabled = true;
        try {
          await saveDynamicAsrUrlToDb(input.value);
          setStatusBanner("Live Cloud ASR URL saved.", "success");
        } catch (err) {
          setStatusBanner(err.message, "warn");
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      $("importSeedBtn")?.addEventListener("click", async () => {
        const btn = $("importSeedBtn");
        const prog = $("importSeedProgress");
        if (btn) btn.disabled = true;
        try {
          const count = await DB.adminImportSeedBatch(session, seedPhrases, (done, total) => {
            if (prog) prog.textContent = `Syncing ${done} / ${total} entries...`;
          });
          const refreshed = await DB.fetchPhrases(seedPhrases);
          phrases = refreshed.phrases;
          renderSectionPills();
          populateAudioPhraseSelect();
          renderPhrases();
          renderPracticeCard();
          if (prog) prog.textContent = `Synced ${count} entries successfully.`;
          setStatusBanner(`Successfully imported ${count} entries into the database.`, "success");
        } catch (err) {
          setStatusBanner("Import error: " + err.message, "warn");
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      applyDialectLabel();

      const renderStatsHtml = (s) => {
        const n = (v) => Number(v || 0);
        const pct = (x, y) => (n(y) ? Math.round((n(x) / n(y)) * 100) + "%" : "0%");
        const tile = (label, value, sub) => `
          <div class="panel" style="padding:10px; text-align:center; margin:0;">
            <div style="font-size:22px; font-weight:700;">${value}</div>
            <div class="small-note muted">${label}${sub ? "<br>" + sub : ""}</div>
          </div>`;
        const st = s.clinical_by_status || {};
        const au = s.audio_by_status || {};
        const us = s.usage || {};
        const ev = s.events_7d || {};
        const tabs = s.tabs_7d || {};
        const list = (rows, key) => (rows && rows.length)
          ? `<ol style="margin:6px 0 0 18px; padding:0;">${rows.map((r) => `<li>${escapeHtml(r[key])} <span class="muted">(${n(r.count)})</span></li>`).join("")}</ol>`
          : `<p class="muted small-note" style="margin:6px 0 0;">Nothing yet.</p>`;
        const daily = Array.isArray(s.daily) ? s.daily : [];
        const maxDay = Math.max(1, ...daily.map((d) => n(d.sessions)));
        const bars = daily.map((d) => `
          <div title="${escapeHtml(String(d.day))}: ${n(d.sessions)} sessions" style="flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:70px;">
            <div style="width:80%; background:var(--accent, #0f766e); border-radius:3px 3px 0 0; height:${Math.max(2, Math.round((n(d.sessions) / maxDay) * 60))}px;"></div>
          </div>`).join("");
        const grid = "display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-top:8px;";
        return `
          <div class="small-note muted">Content</div>
          <div style="${grid}">
            ${tile("Clinical phrases", n(s.clinical_total))}
            ${tile("With approved audio", `${n(s.clinical_with_audio)} / ${n(s.clinical_total)}`, pct(s.clinical_with_audio, s.clinical_total))}
            ${tile("Text-checked", n(st.verified))}
            ${tile("Unconfirmed", n(st.unconfirmed))}
            ${tile("Missing", n(st.missing))}
            ${tile("Glossary terms", n(s.glossary_total), `${n(s.glossary_with_audio)} with audio`)}
          </div>
          <div class="small-note muted" style="margin-top:12px;">Needs your attention</div>
          <div style="${grid}">
            ${tile("Audio awaiting review", n(au.pending))}
            ${tile("Submissions awaiting review", n(s.submissions_pending))}
            ${tile("New feedback", n(s.feedback_new))}
            ${tile("Active contributors", n(s.contributors_active))}
          </div>
          <div class="small-note muted" style="margin-top:12px;">Usage (anonymous; counting starts when this version is live)</div>
          <div style="${grid}">
            ${tile("Devices, last 7 days", n(us.devices_7d))}
            ${tile("Devices, last 30 days", n(us.devices_30d))}
            ${tile("Sessions, last 7 days", n(us.sessions_7d))}
            ${tile("App opens, 7 days", n(us.opens_7d))}
            ${tile("Searches, 7 days", n(ev.search) + n(ev.search_no_results), `${n(ev.search_no_results)} found nothing`)}
            ${tile("Audio plays, 7 days", n(ev.audio_played))}
            ${tile("Listen uses, 7 days", n(ev.listen_used))}
            ${tile("Pinned to tray, 7 days", n(ev.phrase_pinned))}
          </div>
          <div class="small-note muted" style="margin-top:12px;">Sessions per day, last 14 days</div>
          <div style="display:flex; gap:3px; align-items:flex-end; margin-top:6px;">${bars}</div>
          <div class="small-note muted" style="margin-top:12px;"><strong>Searches that found nothing (30 days)</strong>, candidates to add</div>
          ${list(s.top_missing, "term")}
          <div class="small-note muted" style="margin-top:12px;"><strong>Most-played phrases (30 days)</strong></div>
          ${list(s.top_played, "english")}
          <div class="small-note muted" style="margin-top:12px;"><strong>Tabs opened (7 days)</strong></div>
          <p class="small-note" style="margin:6px 0 0;">${Object.keys(tabs).length ? Object.entries(tabs).map(([k, v]) => `${escapeHtml(k)}: ${n(v)}`).join(" · ") : "Nothing yet."}</p>`;
      };
      $("loadStatsBtn")?.addEventListener("click", async () => {
        const box = $("adminStatsBox");
        if (!box) return;
        box.innerHTML = '<p class="muted small-note">Loading...</p>';
        try {
          box.innerHTML = renderStatsHtml(await DB.adminStats(session));
        } catch (err) {
          box.innerHTML = "";
          setStatusBanner("Could not load stats: " + err.message, "warn");
        }
      });

      const loadDialectAdmin = async () => {
        const box = $("dialectAdminBox");
        if (!box) return;
        try {
          const rows = await DB.adminListDialects(session);
          box.innerHTML = rows.map((d) => `
            <div data-dialect-row="${escapeHtml(d.code)}" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
              <code style="min-width:64px;">${escapeHtml(d.code)}</code>
              <input type="text" data-d-label maxlength="60" value="${escapeHtml(d.label)}" style="flex:1; min-width:150px;" />
              <input type="number" data-d-order value="${Number(d.sort_order)}" style="width:68px;" aria-label="Order" />
              <label style="display:flex; align-items:center; gap:4px; font-size:13px;">
                <input type="checkbox" data-d-active ${d.is_active ? "checked" : ""} ${d.code === "idoma" ? "disabled" : ""} style="width:auto;" /> Active
              </label>
              <button type="button" class="btn btn-sm btn-secondary" data-d-save="${escapeHtml(d.code)}">Save</button>
            </div>`).join("") || '<p class="muted small-note">No dialects yet.</p>';
          box.querySelectorAll("[data-d-save]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const row = btn.closest("[data-dialect-row]");
              try {
                await DB.adminUpsertDialect(session, {
                  code: btn.getAttribute("data-d-save"),
                  label: row.querySelector("[data-d-label]").value,
                  sortOrder: Number(row.querySelector("[data-d-order]").value) || 100,
                  isActive: row.querySelector("[data-d-active]").checked
                });
                await afterDialectChange();
                setStatusBanner("Dialect saved.", "success");
              } catch (err) {
                setStatusBanner("Could not save dialect: " + err.message, "warn");
              }
            });
          });
        } catch (err) {
          box.innerHTML = `<p class="muted small-note">Dialects unavailable: ${escapeHtml(err.message)}. Run the latest schema.sql.</p>`;
        }
      };
      const afterDialectChange = async () => {
        await syncDialectsFromDb();
        renderDialectOptions();
        applyDialectLabel();
        renderPhrases();
        renderPracticeCard();
        await loadDialectAdmin();
      };
      $("addDialectBtn")?.addEventListener("click", async () => {
        const code = ($("newDialectCode")?.value || "").trim().toLowerCase();
        const label = ($("newDialectLabel")?.value || "").trim();
        try {
          await DB.adminUpsertDialect(session, { code, label, sortOrder: 100, isActive: true });
          $("newDialectCode").value = "";
          $("newDialectLabel").value = "";
          await afterDialectChange();
          setStatusBanner(`Dialect added: ${label}`, "success");
        } catch (err) {
          setStatusBanner("Could not add dialect: " + err.message, "warn");
        }
      });
      loadDialectAdmin();

      const loadHiddenTerms = async () => {
        const box = $("hiddenTermsBox");
        if (!box) return;
        try {
          const rows = await DB.adminListHiddenPhrases(session);
          box.innerHTML = rows.length
            ? rows.map((r) => `
              <div class="panel" style="margin:6px 0; padding:8px; display:flex; gap:8px; align-items:center; justify-content:space-between;">
                <div>
                  <strong>${escapeHtml(r.english_term)}</strong> <span class="muted small-note">${escapeHtml(r.idoma_term || "")}</span>
                  <div class="muted small-note">${escapeHtml(r.section || "")}</div>
                </div>
                <button type="button" class="btn btn-sm btn-secondary" data-restore="${escapeHtml(r.id)}">Restore</button>
              </div>`).join("")
            : '<p class="muted small-note">No hidden terms.</p>';
          box.querySelectorAll("[data-restore]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              try {
                await DB.adminSetPhrasePublished(session, btn.getAttribute("data-restore"), true);
                await refreshPhrasesFromDb();
                await loadHiddenTerms();
                setStatusBanner("Term restored.", "success");
              } catch (err) {
                setStatusBanner("Could not restore term: " + err.message, "warn");
              }
            });
          });
        } catch (err) {
          box.innerHTML = `<p class="muted small-note">Hidden terms unavailable: ${escapeHtml(err.message)}</p>`;
        }
      };
      $("loadHiddenBtn")?.addEventListener("click", loadHiddenTerms);

      $("saveAckBtn")?.addEventListener("click", async () => {
        const text = ($("ackInput")?.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join("\n");
        try {
          await saveSettingToDb("special_acknowledgments", text);
          specialAck = text ? text.split("\n") : DEFAULT_ACK.slice();
          applySpecialAck();
          setStatusBanner("Acknowledgments saved.", "success");
        } catch (err) {
          setStatusBanner("Could not save acknowledgments: " + err.message, "warn");
        }
      });

      const renderFeedbackInbox = (rows) => {
        const box = $("feedbackInbox");
        if (!box) return;
        const kinds = { wrong_term: "Term looks wrong", missing_term: "Term missing", bug: "Something broken", idea: "Idea", other: "Other" };
        box.innerHTML = rows.length
          ? rows.map((r) => `
              <div class="panel" style="margin:8px 0; padding:10px;">
                <div class="small-note muted">${escapeHtml(kinds[r.kind] || r.kind)} · ${escapeHtml(new Date(r.created_at).toLocaleString())} · ${escapeHtml(r.status)}</div>
                <div style="margin:6px 0; white-space:pre-wrap;">${escapeHtml(r.message)}</div>
                ${r.contact ? `<div class="small-note"><strong>Contact:</strong> ${escapeHtml(r.contact)}</div>` : ""}
                ${r.status !== "done" ? `<button type="button" class="btn btn-sm btn-secondary" data-fb-done="${escapeHtml(r.id)}" style="margin-top:6px;">Mark done</button>` : ""}
              </div>`).join("")
          : `<p class="muted small-note">No feedback yet.</p>`;
        box.querySelectorAll("[data-fb-done]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await DB.adminSetFeedbackStatus(session, btn.getAttribute("data-fb-done"), "done");
              renderFeedbackInbox(await DB.adminListFeedback(session));
            } catch (err) {
              setStatusBanner("Could not update feedback: " + err.message, "warn");
            }
          });
        });
      };
      $("loadFeedbackBtn")?.addEventListener("click", async () => {
        try {
          renderFeedbackInbox(await DB.adminListFeedback(session));
        } catch (err) {
          setStatusBanner("Could not load feedback: " + err.message, "warn");
        }
      });

      $("importGlossaryBtn")?.addEventListener("click", async () => {
        const file = $("glossaryFileInput")?.files?.[0];
        const statusEl = $("glossaryImportStatus");
        const btn = $("importGlossaryBtn");
        if (!file) {
          setStatusBanner("Choose a glossary .json file first.", "warn");
          return;
        }
        if (btn) btn.disabled = true;
        try {
          const parsed = JSON.parse(await file.text());
          const entries = Array.isArray(parsed) ? parsed : parsed.entries;
          if (!Array.isArray(entries) || entries.length === 0) throw new Error("No entries array found in that file.");
          const source = (parsed.meta && (parsed.meta.source || parsed.meta.title)) || file.name;
          const totals = { processed: 0, inserted: 0, variations: 0, skipped_identical: 0, skipped_invalid: 0, updated: 0 };
          for (let i = 0; i < entries.length; i += 100) {
            const res = await DB.adminImportGlossary(session, entries.slice(i, i + 100), source);
            Object.keys(totals).forEach((k) => { totals[k] += Number(res[k] || 0); });
            if (statusEl) statusEl.textContent = `Importing... ${Math.min(i + 100, entries.length)} of ${entries.length}`;
          }
          const refreshed = await DB.fetchPhrases(seedPhrases);
          phrases = refreshed.phrases;
          renderSectionPills();
          populateAudioPhraseSelect();
          renderPhrases();
          renderPracticeCard();
          const summary = `Done: ${totals.inserted} new, ${totals.variations} variants of existing terms, ${totals.skipped_identical} identical (skipped), ${totals.updated} refreshed, ${totals.skipped_invalid} invalid.`;
          if (statusEl) statusEl.textContent = summary;
          setStatusBanner(summary, "success");
        } catch (err) {
          if (statusEl) statusEl.textContent = "";
          setStatusBanner("Glossary import error: " + err.message, "warn");
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      $("exportDatasetBtn")?.addEventListener("click", () => {
        const dataset = [];
        const bucket = window.APP_CONFIG?.AUDIO_BUCKET || "idoma-audio";
        for (const c of data.audioClips) {
          if (c.approval_status !== "approved") continue;
          let url = c.data_url || "";
          if (!url && window.APP_CONFIG?.SUPABASE_URL && c.storage_path) {
            url = `${window.APP_CONFIG.SUPABASE_URL}/storage/v1/object/public/${bucket}/${c.storage_path}`;
          }
          if (!url) continue;
          const phrase = phrases.find((p) => String(p.id) === String(c.phrase_id));
          const spoken = String(c.spoken_text || "").trim();
          const issues = [];
          if (!spoken) issues.push("no_written_text");
          if (/[\/()]/.test(spoken)) issues.push("has_alternatives_or_brackets");
          if (!c.dialect) issues.push("no_dialect");
          dataset.push({
            clip_id: c.id,
            phrase_id: c.phrase_id,
            audio_url: url,
            transcription: spoken,
            dialect: c.dialect || "",
            dialect_note: c.dialect_note || "",
            speaker_id: c.recorded_by_contributor_id || "",
            duration_ms: c.duration_ms || null,
            mime_type: c.mime_type || "",
            english_meaning: phrase ? phrase.english : "",
            section: phrase ? phrase.section : "",
            ready_for_training: issues.length === 0,
            issues
          });
        }

        if (dataset.length === 0) {
          setStatusBanner("No approved audio clips to export yet.", "warn");
          return;
        }

        const ready = dataset.filter((r) => r.ready_for_training).length;
        const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
        const el = document.createElement("a");
        el.href = URL.createObjectURL(blob);
        el.download = `idoma-clinical-speech-dataset-${new Date().toISOString().slice(0, 10)}.json`;
        el.click();
        setStatusBanner(`Exported ${dataset.length} approved clips (${ready} ready for training; the rest list their issues).`, "success");
      });

      $("contribForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await DB.adminUpsertContributor(session, {
            id: $("cId").value || null,
            full_name: $("cName").value.trim(),
            role_title: $("cRole").value.trim(),
            access_code: $("cCode").value.trim(),
            is_admin: $("cIsAdmin").checked,
            show_in_credits: $("cShowCredits").checked,
            is_active: $("cIsActive").checked,
            daily_submission_limit: Number($("cSubLimit").value) || 50,
            daily_audio_limit: Number($("cAudLimit").value) || 50,
            notes: $("cNotes").value.trim()
          });
          credits = await DB.fetchPublicCredits();
          renderCredits();
          setStatusBanner("Contributor saved and credits updated.", "success");
          await renderAdminDashboard();
        } catch (err) {
          setStatusBanner(err.message, "warn");
        }
      });

      $("cResetBtn")?.addEventListener("click", () => {
        $("cId").value = "";
        $("contribForm")?.reset();
      });

      container.querySelectorAll("[data-prefill-vol]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const v = pendingVols.find((x) => x.id === btn.getAttribute("data-prefill-vol"));
          if (!v) return;
          const cleanName = (v.english_term || "").replace(/^Volunteer:\s*/i, "").trim();
          const firstToken = (cleanName.split(/\s+/)[0] || "USER").toUpperCase().replace(/[^A-Z0-9]/g, "");
          $("cId").value = "";
          $("cName").value = cleanName;
          $("cRole").value = v.subsection || "Dialect & Translation Contributor";
          $("cCode").value = `CONT-${firstToken}-${Math.floor(10 + Math.random() * 89)}`;
          $("cNotes").value = [v.alala_term, v.requester_label].filter(Boolean).join(" · ");
          $("cIsAdmin").checked = false;
          $("cShowCredits").checked = true;
          $("cIsActive").checked = true;
          setStatusBanner("Applicant details prefilled in Contributor Form—review code and click Save Contributor.", "info");
          $("cCode")?.focus();
        });
      });

      container.querySelectorAll("[data-edit-c]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const found = data.contributors.find((x) => x.id === btn.getAttribute("data-edit-c"));
          if (!found) return;
          $("cId").value = found.id;
          $("cName").value = found.full_name || "";
          $("cRole").value = found.role_title || "";
          $("cCode").value = found.access_code || "";
          $("cNotes").value = found.notes || "";
          $("cSubLimit").value = found.daily_submission_limit || 50;
          $("cAudLimit").value = found.daily_audio_limit || 50;
          $("cIsAdmin").checked = Boolean(found.is_admin);
          $("cShowCredits").checked = found.show_in_credits !== false;
          $("cIsActive").checked = found.is_active !== false;
        });
      });

      container.querySelectorAll("[data-del-c]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await DB.adminDeleteContributor(session, btn.getAttribute("data-del-c"));
            credits = await DB.fetchPublicCredits();
            renderCredits();
            setStatusBanner("Contributor removed.", "info");
            await renderAdminDashboard();
          } catch (err) {
            setStatusBanner(err.message, "warn");
          }
        });
      });

      container.querySelectorAll("[data-sub-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await DB.adminReviewSubmission(session, btn.getAttribute("data-sub-id"), btn.getAttribute("data-sub-action"), "", seedPhrases);
            const refreshed = await DB.fetchPhrases(seedPhrases);
            phrases = refreshed.phrases;
            renderSectionPills();
            populateAudioPhraseSelect();
            renderPhrases();
            renderPracticeCard();
            setStatusBanner("Submission moderation completed.", "success");
            await renderAdminDashboard();
          } catch (err) {
            setStatusBanner(err.message, "warn");
          }
        });
      });

      container.querySelectorAll("[data-aud-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await DB.adminReviewAudioClip(session, btn.getAttribute("data-aud-id"), btn.getAttribute("data-aud-action"), true, "");
            audioMap = await DB.fetchApprovedAudioMap();
            renderPhrases();
            setStatusBanner("Audio clip moderation updated.", "success");
            await renderAdminDashboard();
          } catch (err) {
            setStatusBanner(err.message, "warn");
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="notice-banner notice-warn">${escapeHtml(err.message)}</p>`;
    }
  }

  function switchTab(tabId) {
    Usage.log("tab_view", tabId);
    document.querySelectorAll(".tab-btn").forEach((b) => {
      const isActive = b.getAttribute("data-tab") === tabId;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", String(isActive));
      b.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== tabId;
    });
    if (tabId === "trayTab") renderTray();
    if (tabId === "practiceTab") renderPracticeCard();
    if (tabId === "contributeTab") {
      renderContributeGuestNotice();
      toggleSubFormMode();
    }
    if (tabId === "aboutTab") renderCredits();
    if (tabId === "adminTab") renderAdminDashboard();
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/\x26/g, "\x26amp;")
      .replace(/\x3c/g, "\x26lt;")
      .replace(/\x3e/g, "\x26gt;")
      .replace(/\x22/g, "\x26quot;")
      .replace(/\x27/g, "\x26#39;");
  }

  function bindEvents() {
    const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });
    // Arrow-key navigation across the tab strip, per WAI-ARIA tabs pattern
    document.querySelector(".tabs-nav")?.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      const current = tabBtns.findIndex((b) => b.classList.contains("active"));
      let next;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabBtns.length - 1;
      else next = e.key === "ArrowRight" ? current + 1 : current - 1;
      next = (next + tabBtns.length) % tabBtns.length;
      tabBtns[next].focus();
      switchTab(tabBtns[next].getAttribute("data-tab"));
      e.preventDefault();
    });

    $("dismissDisclaimerBtn")?.addEventListener("click", () => {
      $("disclaimerBar").hidden = true;
    });

    $("footerLoginTrigger")?.addEventListener("click", openLoginBox);
    $("footerVolunteerBtn")?.addEventListener("click", openVolunteerForm);
    $("aboutVolunteerBtn")?.addEventListener("click", openVolunteerForm);
    $("footerAboutBtn")?.addEventListener("click", () => {
      switchTab("aboutTab");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    $("cancelLoginBtn")?.addEventListener("click", () => {
      renderSessionUI();
    });

    $("subType")?.addEventListener("change", toggleSubFormMode);

    let searchLogTimer = null;
    let searchRenderTimer = null;
    $("searchInput")?.addEventListener("input", () => {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(renderPhrases, 120);
      clearTimeout(searchLogTimer);
      searchLogTimer = setTimeout(() => {
        const q = ($("searchInput")?.value || "").trim();
        if (q.length < 2) return;
        if (getFilteredPhrases().length > 0) Usage.log("search");
        else Usage.log("search_no_results", Usage.cleanTerm(q));
      }, 1500);
    });
    $("statusFilter")?.addEventListener("change", (e) => {
      activeStatus = e.target.value;
      renderPhrases();
    });

    $("alalaFilterBtn")?.addEventListener("click", () => {
      dialectOnly = !dialectOnly;
      $("alalaFilterBtn").classList.toggle("is-active", dialectOnly);
      renderPhrases();
    });

    $("bedsideToggleBtn")?.addEventListener("click", () => {
      bedsideMode = !bedsideMode;
      $("bedsideToggleBtn").classList.toggle("is-active", bedsideMode);
      $("bedsideToggleBtn").textContent = bedsideMode ? "Exit High-Contrast" : "Ward High-Contrast";
      document.body.classList.toggle("bedside-active", bedsideMode);
      renderPhrases();
      renderTray();
    });

    $("quickRequestBtn")?.addEventListener("click", () => {
      if ($("subType")) {
        $("subType").value = "term_request";
        toggleSubFormMode();
      }
      switchTab("contributeTab");
    });

    $("clearTrayBtn")?.addEventListener("click", () => {
      trayIds.clear();
      DB.saveTrayIds(trayIds);
      updateTrayBadge();
      renderTray();
      renderPhrases();
    });

    $("goFinderFromTrayBtn")?.addEventListener("click", () => switchTab("finderTab"));

    $("loginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        session = await DB.loginWithCode($("accessCodeInput").value);
        $("accessCodeInput").value = "";
        renderSessionUI();
        setStatusBanner(`Welcome, ${session.full_name}.`, "success");
        if (session.is_admin) {
          switchTab("adminTab");
        }
      } catch (err) {
        setStatusBanner(err.message, "warn");
      }
    });

    $("logoutBtn")?.addEventListener("click", () => {
      DB.clearSavedSession();
      session = null;
      renderSessionUI();
      switchTab("finderTab");
      setStatusBanner("Signed out.", "info");
    });

    $("phraseSubForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const rawType = $("subType").value;

        if (rawType === "volunteer_request") {
          const volName = $("volName")?.value.trim();
          const volContact = $("volContact")?.value.trim();
          const volDialects = $("volDialects")?.value.trim();
          const volRole = $("volRole")?.value || "Translation & Dialect Contributor";
          const volNotes = $("volNotes")?.value.trim() || "";

          if (!volName || !volContact || !volDialects) {
            throw new Error("Please provide your name, phone/WhatsApp contact, and dialect(s).");
          }

          await DB.submitPhraseOrRequest({
            submission_type: "term_request",
            section: "Volunteer Application",
            subsection: volRole,
            english_term: `Volunteer: ${volName}`,
            alala_term: `Dialects: ${volDialects}`,
            clinical_note: `Role: ${volRole} | Contact: ${volContact}${volNotes ? " | Notes: " + volNotes : ""}`,
            proposed_status: "unconfirmed",
            requester_label: `${volName} (${volContact})`
          }, null);

          $("phraseSubForm").reset();
          $("subType").value = "volunteer_request";
          toggleSubFormMode();
          setStatusBanner("Volunteer application received! The Admin team will review and send your contributor access code.", "success");
          if (session && session.is_admin) await renderAdminDashboard();
          return;
        }

        const englishVal = $("subEnglish").value.trim();
        if (!englishVal) throw new Error("English term or question is required.");

        const subType = session ? rawType : "term_request";
        const dialectLabel = $("subDialectLabel")?.value || "";
        const rawClinical = $("subClinical").value.trim();
        const combinedClinical = dialectLabel && $("subAlala")?.value.trim()
          ? `[${dialectLabel} Variant] ${rawClinical}`.trim()
          : rawClinical;

        await DB.submitPhraseOrRequest({
          submission_type: subType,
          target_phrase_id: subType === "edit_phrase" ? ($("subTargetId").value || null) : null,
          variation_of_id: $("subVariationOf").value || null,
          allow_variation: $("subAllowVar").checked,
          section: $("subSection").value,
          subsection: $("subSubsection").value.trim(),
          english_term: englishVal,
          idoma_term: $("subIdoma").value.trim(),
          alala_term: $("subAlala")?.value.trim() || "",
          syllables: $("subSyllables").value.trim(),
          phonetic_hint: $("subPhonetic").value.trim(),
          tone_note: $("subTone").value.trim(),
          clinical_note: combinedClinical,
          proposed_status: $("subStatus").value,
          requester_label: $("subRequester")?.value.trim() || "Public user"
        }, session);

        $("phraseSubForm").reset();
        $("subTargetId").value = "";
        toggleSubFormMode();
        setStatusBanner(
          session
            ? "Submitted to the moderation queue for Admin approval."
            : "Term request submitted! A reviewer can add it shortly.",
          "success"
        );
        if (session && session.is_admin) await renderAdminDashboard();
      } catch (err) {
        setStatusBanner(err.message, "warn");
      }
    });

    function refreshSpokenPrefill() {
      const sel = $("audioPhraseSelect");
      const textEl = $("audioSpokenText");
      const hintEl = $("audioSpokenHint");
      if (!sel || !textEl) return;
      const p = phrases.find((x) => String(x.id) === String(sel.value));
      const dialect = $("audioDialect") ? $("audioDialect").value : "idoma";
      const entry = p ? String((dialect === "alala" ? p.alala : (dialect === "idoma" ? p.idoma : "")) || "").trim() : "";
      const first = entry.split("/")[0].replace(/\(.*?\)/g, "").replace(/["“”]/g, "").trim();
      textEl.value = first;
      if (hintEl) {
        hintEl.textContent = entry
          ? `Phrasebook entry: ${entry}. Keep only the version you actually say.`
          : "No written form yet for this dialect. Type exactly what you say.";
      }
    }
    $("audioPhraseSelect")?.addEventListener("change", refreshSpokenPrefill);
    $("audioDialect")?.addEventListener("change", refreshSpokenPrefill);
    $("audioSpokenText")?.addEventListener("focus", () => {
      if (!$("audioSpokenText").value) refreshSpokenPrefill();
    });

    // Privacy toggle for anonymous usage counts
    const optBox = $("usageOptOut");
    if (optBox) {
      optBox.checked = Usage.optedOut();
      optBox.addEventListener("change", () => Usage.setOptOut(optBox.checked));
    }

    // Recorder: find terms quickly (glossary, no-audio-yet) and upload an existing file
    const refilterRecorder = () => {
      populateAudioPhraseSelect();
      $("audioPhraseSelect")?.dispatchEvent(new Event("change"));
    };
    $("audioPhraseFilter")?.addEventListener("input", refilterRecorder);
    $("audioKindFilter")?.addEventListener("change", refilterRecorder);
    $("audioNeedsOnly")?.addEventListener("change", refilterRecorder);

    $("audioFileInput")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        if (!session) {
          e.target.value = "";
          setStatusBanner("Sign in with a contributor or admin access code to submit audio.", "warn");
          return;
        }
        if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|wav|webm|ogg|aac|opus)$/i.test(file.name)) {
          throw new Error("Please choose an audio file (mp3, m4a, wav, webm or ogg).");
        }
        if (file.size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB. Trim or compress it first.");
        const url = URL.createObjectURL(file);
        const durationMs = await new Promise((resolve) => {
          const a = new Audio();
          const done = (v) => resolve(v);
          a.preload = "metadata";
          a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
          a.onerror = () => done(0);
          a.src = url;
          setTimeout(() => done(0), 4000);
        });
        recordedDraft = { blob: file, mimeType: file.type || "audio/mpeg", durationMs };
        $("audioPreview").src = url;
        $("audioPreview").hidden = false;
        $("saveAudioBtn").disabled = false;
        $("recordStateText").textContent = `Uploaded ${file.name} (${Math.round(durationMs / 1000)}s). Preview, then submit for approval.`;
      } catch (err) {
        recordedDraft = null;
        e.target.value = "";
        setStatusBanner(err.message, "warn");
      }
    });

    // Scroll shortcuts
    const topBtn = $("scrollTopBtn");
    const botBtn = $("scrollBottomBtn");
    const updateScrollBtns = () => {
      const y = window.scrollY || 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (topBtn) topBtn.style.display = y > 300 ? "" : "none";
      if (botBtn) botBtn.style.display = max - y > 300 ? "" : "none";
    };
    window.addEventListener("scroll", updateScrollBtns, { passive: true });
    window.addEventListener("resize", updateScrollBtns);
    if (window.ResizeObserver) new ResizeObserver(updateScrollBtns).observe(document.body);
    topBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    botBtn?.addEventListener("click", () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
    updateScrollBtns();

    // Feedback
    $("fbSendBtn")?.addEventListener("click", async () => {
      const btn = $("fbSendBtn");
      const msg = ($("fbMessage")?.value || "").trim();
      if (msg.length < 5) {
        setStatusBanner("Please write a little more (at least 5 characters).", "warn");
        return;
      }
      btn.disabled = true;
      try {
        await DB.submitFeedback({ kind: $("fbKind").value, message: msg, contact: ($("fbContact")?.value || "").trim() });
        $("fbMessage").value = "";
        Usage.log("feedback_sent");
        setStatusBanner("Thank you! Your feedback was sent.", "success");
      } catch (err) {
        setStatusBanner("Could not send feedback: " + err.message, "warn");
      } finally {
        btn.disabled = false;
      }
    });
    $("footerFeedbackBtn")?.addEventListener("click", () => {
      switchTab("aboutTab");
      setTimeout(() => $("feedbackPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    });

    $("recordToggleBtn")?.addEventListener("click", async () => {
      try {
        if (!session) {
          setStatusBanner("Sign in with a contributor or admin access code to record and submit audio.", "warn");
          return;
        }
        if (!isRecording) {
          recordedDraft = null;
          $("saveAudioBtn").disabled = true;
          await Matcher.startRecording();
          isRecording = true;
          $("recordToggleBtn").textContent = "Stop Recording";
          $("recordStateText").textContent = "Recording... speak clearly and verify pitch aloud.";
        } else {
          recordedDraft = await Matcher.stopRecording();
          isRecording = false;
          $("recordToggleBtn").textContent = "Record Pronunciation";
          const url = URL.createObjectURL(recordedDraft.blob);
          $("audioPreview").src = url;
          $("audioPreview").hidden = false;
          $("saveAudioBtn").disabled = false;
          $("recordStateText").textContent = `Recorded (${Math.round(recordedDraft.durationMs / 1000)}s). Preview and submit for approval.`;
        }
      } catch (err) {
        isRecording = false;
        $("recordToggleBtn").textContent = "Record Pronunciation";
        setStatusBanner(err.message, "warn");
      }
    });

    $("saveAudioBtn")?.addEventListener("click", async () => {
      try {
        if (!session) {
          setStatusBanner("Sign in with a contributor or admin access code to submit audio.", "warn");
          return;
        }
        if (!recordedDraft) throw new Error("Record a voice clip first.");
        const spokenText = $("audioSpokenText").value.trim();
        if (!spokenText) throw new Error("Type exactly what you said in this recording before submitting.");
        if (/[\/()]/.test(spokenText)) throw new Error("Use one version only: remove '/' alternatives and brackets so the text matches what you said.");
        await DB.uploadAudioRecording({
          phraseId: $("audioPhraseSelect").value,
          blob: recordedDraft.blob,
          mimeType: recordedDraft.mimeType,
          durationMs: recordedDraft.durationMs,
          dialectNote: $("audioDialectNote").value.trim(),
          dialect: $("audioDialect").value,
          spokenText
        }, session);
        recordedDraft = null;
        $("saveAudioBtn").disabled = true;
        $("audioPreview").hidden = true;
        $("audioDialectNote").value = "";
        $("audioSpokenText").value = "";
        if ($("audioSpokenHint")) $("audioSpokenHint").textContent = "";
        $("recordStateText").textContent = "Submitted! Audio will go live once approved by Admin.";
        setStatusBanner("Voice clip submitted for admin review.", "success");
        if (session && session.is_admin) await renderAdminDashboard();
      } catch (err) {
        setStatusBanner(err.message, "warn");
      }
    });

    $("listenRecordBtn")?.addEventListener("click", async () => {
      try {
        if (!isRecording) {
          await Matcher.startRecording();
          isRecording = true;
          $("listenRecordBtn").textContent = "Stop & Check Best Matches";
          $("listenStatus").textContent = "Listening to short patient response...";
        } else {
          const rec = await Matcher.stopRecording();
          isRecording = false;
          $("listenRecordBtn").textContent = "Listen for Best Match";
          $("listenStatus").textContent = "Analyzing speech...";

          const result = await Matcher.matchPatientSpeech(rec.blob, phrases, audioMap);
          const matches = Array.isArray(result) ? result : (result.matches || []);
          const transcript = Array.isArray(result) ? null : result.transcript;
          const asrError = Array.isArray(result) ? null : result.asrError;
          Usage.log("listen_used", matches.length ? "match" : "no_match");

          const statusNoteHtml = asrError
            ? `<div class="clinical-note" style="margin-top:0; margin-bottom:10px;">
                 <strong>Cloud ASR Note:</strong> ${escapeHtml(asrError)} (using offline fallback)
               </div>`
            : "";

          const transcriptBoxHtml = transcript
            ? `<div class="tone-alert" style="margin-top:0; margin-bottom:10px; background:var(--surface-alt); color:var(--text); border-color:var(--accent);">
                 <strong>AI Heard (Idoma Transcription):</strong> "${escapeHtml(transcript)}"
               </div>`
            : statusNoteHtml;

          if (matches.length === 0) {
            const hasAnyAudio = Object.keys(audioMap).length > 0;
            $("listenStatus").textContent = "";
            $("listenMatches").innerHTML = `
              ${transcriptBoxHtml}
              <div class="match-card">
                <div>
                  <strong>No exact database card matched</strong>
                  <div class="muted small-note">
                    ${transcript
                      ? "OmniASR transcribed the speech above, though no exact entry matched in the verified glossary yet. You can search keywords in Phrase Finder or use the response cards."
                      : (asrError
                          ? `Cloud AI note: ${escapeHtml(asrError)}.`
                          : (hasAnyAudio
                              ? "The patient's response did not closely match any recorded phrase. Try closer to the mic, or use the response cards."
                              : "No approved contributor audio clips are available yet for offline matching."))}
                  </div>
                </div>
              </div>
            `;
            return;
          }

          $("listenStatus").textContent = "Verified database matches (confirm directly with patient):";
          $("listenMatches").innerHTML = `
            ${transcriptBoxHtml}
            ${matches.map((m) => `
              <div class="match-card">
                <div>
                  <strong>${escapeHtml(m.phrase.english)}</strong> — <span class="idoma-term">${escapeHtml(m.phrase.idoma || m.phrase.alala)}</span>
                  <div class="muted small-note">Match score: ${m.confidence}% · Engine: <code>${escapeHtml(m.engine || "match")}</code> · Confirm directly with patient</div>
                </div>
                ${m.hasAudio ? `<button type="button" class="btn btn-sm btn-primary" data-match-play="${escapeHtml(audioMap[m.phrase.id].url)}">Hear Reference</button>` : ""}
              </div>
            `).join("")}
          `;
          $("listenMatches").querySelectorAll("[data-match-play]").forEach((b) => {
            b.addEventListener("click", () => new Audio(b.getAttribute("data-match-play")).play().catch(() => {}));
          });
        }
      } catch (err) {
        isRecording = false;
        $("listenRecordBtn").textContent = "Listen for Best Match";
        setStatusBanner(err.message, "warn");
      }
    });

    document.querySelectorAll("[data-response-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const val = chip.getAttribute("data-response-chip");
        const log = $("responseLog");
        if (log) {
          const entry = document.createElement("li");
          entry.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — Confirmed: ${val}`;
          log.prepend(entry);
        }
      });
    });
  }

  function showLoadError(message) {
    const box = $("loadErrorBox");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <h3>Couldn't load the phrase list</h3>
      <p class="muted small-note">${escapeHtml(message)} Check your connection and try again.</p>
      <button type="button" class="btn btn-primary btn-sm" id="retryLoadBtn">Retry</button>
    `;
    $("retryLoadBtn")?.addEventListener("click", async () => {
      box.hidden = true;
      box.innerHTML = "";
      await loadPhraseData();
    });
  }

  async function loadPhraseData() {
    // 1. Render seed phrases immediately so the screen is usable right away
    seedPhrases = await DB.loadSeedPhrases();
    phrases = seedPhrases;
    renderSectionPills();
    populateAudioPhraseSelect();
    renderPhrases();

    // 2. Fetch live Supabase phrases, approved audio, and credits in parallel
    const [fetched, liveAudioMap, liveCredits] = await Promise.all([
      DB.fetchPhrases(seedPhrases),
      DB.fetchApprovedAudioMap(),
      DB.fetchPublicCredits()
    ]);

    phrases = fetched.phrases;
    audioMap = liveAudioMap;
    credits = liveCredits;

    renderSectionPills();
    populateAudioPhraseSelect();
    renderPhrases();
    renderTray();
    renderPracticeCard();
    renderCredits();
    renderGuideToneExamples();

    if (DB.isLive() && fetched.source === "supabase-empty-fallback" && session && session.is_admin) {
      setStatusBanner("Supabase connected! Database table is currently empty—open Admin Studio and click 'Import / Sync Seed JSON to DB' to populate all entries.", "info");
    }
  }

  async function init() {
    try {
      bindEvents();
      toggleSubFormMode();
      if (!DB) throw new Error("PhraseDB failed to load. Check js/config.js and js/db.js for syntax errors.");
      DB.initClient();
      await syncDynamicAsrUrlFromDb();
      await syncDialectsFromDb();
      renderDialectOptions();
      applyDialectLabel();
      await syncAckFromDb();
      applySpecialAck();
      session = DB.getSavedSession();
      trayIds = DB.getTrayIds();
      updateTrayBadge();
      renderSessionUI();
      Usage.openOnce();

      await loadPhraseData();
    } catch (err) {
      console.error("App init failed:", err);
      const countEl = $("resultCount");
      if (countEl) countEl.textContent = "Couldn't load phrases";
      showLoadError(err?.message || String(err));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
