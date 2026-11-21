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
    const sections = ["ALL", ...Array.from(new Set(phrases.map((p) => p.section).filter(Boolean)))];
    wrap.innerHTML = sections.map((sec) => {
      const label = sec === "ALL" ? `All (${phrases.length})` : sec;
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
    const basePool = phrases.filter((p) => {
      if (activeSection !== "ALL" && p.section !== activeSection) return false;
      if (activeStatus !== "ALL" && p.status !== activeStatus) return false;
      if (dialectOnly && !p.alala && !p.variationLabel) return false;
      return true;
    });

    if (!q) {
      return basePool.map((p) => ({ ...p, _matchedVia: null }));
    }

    if (window.ClinicalSearch) {
      return window.ClinicalSearch.searchAndRank(basePool, q).map((item) => ({
        ...item.phrase,
        _matchedVia: item.matchedVia
      }));
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
      ? `<button type="button" class="btn btn-sm btn-primary" data-play-url="${escapeHtml(clip.url)}">Play Audio</button>`
      : `<span class="muted small-note">No audio yet</span>`;

    const variantTag = p.variationLabel || "Alala (Orokam)";

    return `
      <article class="phrase-card status-${escapeHtml(p.status)} ${bedsideMode ? "bedside-card" : ""}">
        <div>
          <div class="card-top">
            <span class="sec-tag">${escapeHtml(p.section)}${p.subsection ? " · " + escapeHtml(p.subsection) : ""}</span>
            ${statusBadgeHtml(p.status)}
          </div>
          ${p._matchedVia ? `<div class="muted small-note" style="margin-bottom:4px;">Matched via synonym/spelling: <strong>${escapeHtml(p._matchedVia)}</strong></div>` : ""}
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
          <div style="display:flex; gap:6px;">
            ${session ? `<button type="button" class="btn btn-sm btn-secondary" data-record-phrase="${escapeHtml(p.id)}">Record Audio</button>` : ""}
            <button type="button" class="btn btn-sm btn-ghost" data-suggest-edit="${escapeHtml(p.id)}">Edit</button>
          </div>
        </div>
      </article>
    `;
  }

  function bindCardInteractions(container) {
    container.querySelectorAll("[data-play-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-play-url");
        if (activeAudioEl) activeAudioEl.pause();
        activeAudioEl = new Audio(url);
        activeAudioEl.play().catch((e) => setStatusBanner("Could not play audio: " + e.message, "warn"));
      });
    });

    container.querySelectorAll("[data-pin-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-pin-id"));
        if (trayIds.has(id)) trayIds.delete(id);
        else trayIds.add(id);
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
    if (countEl) {
      countEl.textContent = `Showing ${filtered.length} of ${phrases.length} clinical entries`;
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
    listEl.innerHTML = filtered.map(createCardHtml).join("");
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

    const translated = phrases.filter((p) => (p.idoma || p.alala) && p.status !== "missing");
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

    const variantTag = item.variationLabel || "Alala (Orokam)";
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
    sel.innerHTML = phrases
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.english)}${p.idoma ? " — " + escapeHtml(p.idoma) : (p.alala ? " — " + escapeHtml(p.alala) + " (Variant)" : " [Blank]")}</option>`)
      .join("");
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
      const liveDbCount = DB.isLive() ? phrases.length : 0;
      const isSynced = DB.isLive() && liveDbCount >= seedPhrases.length && seedPhrases.length > 0;
      const pendingAll = data.submissions.filter((s) => s.review_status === "pending");
      const pendingVols = pendingAll.filter((s) => s.section === "Volunteer Application" || s.submission_type === "volunteer_request");
      const pendingSubs = pendingAll.filter((s) => s.section !== "Volunteer Application" && s.submission_type !== "volunteer_request");
      const pendingAudio = data.audioClips.filter((a) => a.approval_status === "pending");
      const approvedAudioCount = Object.keys(audioMap).length;

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

      $("exportDatasetBtn")?.addEventListener("click", () => {
        const dataset = [];
        for (const p of phrases) {
          const clip = audioMap[p.id];
          if (!clip || !clip.url) continue;
          const transcript = (p.idoma || p.alala || "").trim();
          if (!transcript) continue;

          dataset.push({
            phrase_id: p.id,
            audio_url: clip.url,
            transcription: transcript,
            english_meaning: p.english,
            dialect: p.variationLabel || (p.alala && !p.idoma ? "Alala (Orokam)" : "Idoma (General)"),
            section: p.section,
            verified: p.status === "verified"
          });
        }

        if (dataset.length === 0) {
          setStatusBanner("No approved audio clips with transcriptions to export yet.", "warn");
          return;
        }

        const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `idoma-clinical-speech-dataset-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setStatusBanner(`Exported ${dataset.length} labeled Idoma audio clips for AI training.`, "success");
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
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
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
      .replace(/\x22/g, "\x26quot;");
  }
  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
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

    $("searchInput")?.addEventListener("input", renderPhrases);
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
        await DB.uploadAudioRecording({
          phraseId: $("audioPhraseSelect").value,
          blob: recordedDraft.blob,
          mimeType: recordedDraft.mimeType,
          durationMs: recordedDraft.durationMs,
          dialectNote: $("audioDialectNote").value.trim()
        }, session);
        recordedDraft = null;
        $("saveAudioBtn").disabled = true;
        $("audioPreview").hidden = true;
        $("audioDialectNote").value = "";
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

          const transcriptBoxHtml = transcript
            ? `<div class="tone-alert" style="margin-top:0; margin-bottom:10px; background:var(--surface-alt); color:var(--text); border-color:var(--accent);">
                 <strong>AI Heard (Idoma Transcription):</strong> "${escapeHtml(transcript)}"
               </div>`
            : "";

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
                  <div class="muted small-note">Match score: ${m.confidence}% · Confirm directly with patient</div>
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

 async function init() {
    try {
      bindEvents();
      toggleSubFormMode();
      if (!DB) throw new Error("PhraseDB failed to load. Check js/config.js and js/db.js for syntax errors.");
      DB.initClient();
      session = DB.getSavedSession();
      trayIds = DB.getTrayIds();
      updateTrayBadge();
      renderSessionUI();

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
    } catch (err) {
      console.error("App init failed:", err);
      const countEl = $("resultCount");
      if (countEl) countEl.textContent = "Startup error — see banner below";
      setStatusBanner("Startup error: " + (err?.message || err), "warn");
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
