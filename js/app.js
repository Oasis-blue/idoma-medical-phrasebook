(function () {
  const DB = window.PhraseDB;
  const Matcher = window.AudioMatcher;

  let seedPhrases = [];
  let phrases = [];
  let audioMap = {};
  let credits = [];
  let session = null;
  let bedsideMode = false;
  let activeSection = "ALL";
  let activeStatus = "ALL";
  let practiceSection = "ALL";
  let practiceDirection = "en_to_id"; // "en_to_id" | "id_to_en"
  let practiceIndex = 0;
  let practiceStreak = 0;
  let practiceRevealed = false;
  let recordedDraft = null;
  let isRecording = false;
  let activeAudioEl = null;

  const $ = (id) => document.getElementById(id);

  function setStatusBanner(msg, type = "info") {
    const el = $("systemNotice");
    if (!el) return;
    el.textContent = msg;
    el.className = `notice-banner notice-${type}`;
  }

  let loginExpanded = false;

  function ensureLoginToggle() {
    const loginForm = $("loginForm");
    const authBox = loginForm?.parentElement || document.querySelector(".auth-box");
    if (!loginForm || !authBox || $("loginToggleBtn")) return;

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.id = "loginToggleBtn";
    toggleBtn.className = "btn btn-sm btn-ghost";
    toggleBtn.textContent = "Contributor / Admin Login";

    const wrapper = document.createElement("div");
    wrapper.className = "auth-toggle-row";
    loginForm.parentNode.insertBefore(wrapper, loginForm);
    wrapper.appendChild(toggleBtn);
    loginForm.classList.add("login-panel-compact");
    wrapper.appendChild(loginForm);

    toggleBtn.addEventListener("click", () => {
      loginExpanded = !loginExpanded;
      loginForm.hidden = !loginExpanded;
      toggleBtn.textContent = loginExpanded ? "Hide Login" : "Contributor / Admin Login";
      if (loginExpanded) {
        $("accessCodeInput")?.focus();
      }
    });
  }

  function renderSessionBadge() {
    ensureLoginToggle();
    const infoEl = $("sessionStatus");
    const logoutBtn = $("logoutBtn");
    const loginForm = $("loginForm");
    const toggleBtn = $("loginToggleBtn");
    if (!infoEl) return;

    if (session) {
      loginExpanded = false;
      infoEl.textContent = `Signed in: ${session.full_name} (${session.is_admin ? "Admin" : session.role_title})`;
      if (toggleBtn) toggleBtn.hidden = true;
      if (loginForm) loginForm.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
    } else {
      infoEl.textContent = "Guest mode (Browse, Practice, Listen & Request Terms).";
      if (toggleBtn) {
        toggleBtn.hidden = false;
        toggleBtn.textContent = loginExpanded ? "Hide Login" : "Contributor / Admin Login";
      }
      if (loginForm) {
        loginForm.hidden = !loginExpanded;
      }
      if (logoutBtn) logoutBtn.hidden = true;
    }

    const adminTab = document.querySelector('[data-tab="adminTab"]');
    if (adminTab) {
      adminTab.hidden = !(session && session.is_admin);
    }
    renderContributeGuestNotice();
  }

  function openLoginPrompt() {
    ensureLoginToggle();
    loginExpanded = true;
    const toggleBtn = $("loginToggleBtn");
    const loginForm = $("loginForm");
    if (toggleBtn) {
      toggleBtn.hidden = false;
      toggleBtn.textContent = "Hide Login";
    }
    if (loginForm) {
      loginForm.hidden = false;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      $("accessCodeInput")?.focus();
    }, 150);
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
        <span><strong>Guest mode:</strong> You can request missing terms here. Contributors and admins can sign in with an access code to submit full phrase edits or voice clips.</span>
        <button type="button" class="btn btn-sm btn-secondary" id="openLoginFromContributeBtn">Enter Contributor / Admin Code</button>
      `;
      tabEl.prepend(notice);
      $("openLoginFromContributeBtn")?.addEventListener("click", openLoginPrompt);
    }
    notice.hidden = false;
  }

  function populateSectionFilter() {
    const sel = $("sectionFilter");
    if (!sel) return;
    const sections = Array.from(new Set(phrases.map((p) => p.section).filter(Boolean)));
    sel.innerHTML = `<option value="ALL">All Clinical Sections (${phrases.length})</option>` +
      sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sel.value = activeSection;
  }

  function getFilteredPhrases() {
    const q = ($("searchInput")?.value || "").trim().toLowerCase();
    return phrases.filter((p) => {
      if (activeSection !== "ALL" && p.section !== activeSection) return false;
      if (activeStatus !== "ALL" && p.status !== activeStatus) return false;
      if (!q) return true;
      const hay = [p.english, p.idoma, p.syllables, p.phonetic, p.tone, p.clinical, p.section, p.subsection]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function statusBadgeHtml(status) {
    if (status === "verified") return `<span class="badge badge-verified">Verified</span>`;
    if (status === "missing") return `<span class="badge badge-missing">Missing / Draft Blank</span>`;
    return `<span class="badge badge-unconfirmed">Unconfirmed / Verify Aloud</span>`;
  }

  function renderPhrases() {
    const listEl = $("phraseList");
    const fallbackEl = $("fallbackBox");
    const countEl = $("resultCount");
    if (!listEl) return;

    const q = ($("searchInput")?.value || "").trim();
    const filtered = getFilteredPhrases();
    if (countEl) {
      countEl.textContent = `${filtered.length} of ${phrases.length} entries shown`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = "";
      if (fallbackEl) {
        fallbackEl.hidden = false;
        const keywords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const related = phrases
          .filter((p) => p.idoma && keywords.some((w) => (p.english + " " + p.clinical + " " + p.section).toLowerCase().includes(w)))
          .slice(0, 4);

        fallbackEl.innerHTML = `
          <h3>Exact translation not found in verified glossary</h3>
          <p>Written spelling alone cannot capture Idoma tone, so we do not guess unverified translations. You can request this term below or check related entries:</p>
          ${related.length
            ? `<div class="related-list">${related.map((r) => `<button type="button" class="chip-btn" data-jump-phrase="${escapeHtml(r.english)}">${escapeHtml(r.english)} → <strong>${escapeHtml(r.idoma)}</strong></button>`).join("")}</div>`
            : `<p class="muted">No close keyword matches found.</p>`}
          <button type="button" class="btn btn-primary" id="openRequestFromFallback">Request "${escapeHtml(q || "Missing Term")}"</button>
        `;
        $("openRequestFromFallback")?.addEventListener("click", () => {
          if ($("subEnglish")) $("subEnglish").value = q;
          if ($("subType")) $("subType").value = "term_request";
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

    listEl.innerHTML = filtered.map((p) => {
      const clip = audioMap[p.id];
      const audioBtn = clip && clip.url
        ? `<button type="button" class="btn btn-sm btn-secondary" data-play-url="${escapeHtml(clip.url)}" data-play-label="${escapeHtml(p.english)}">Play Approved Audio</button>`
        : `<span class="muted small-note">No approved audio yet</span>`;

      return `
        <article class="phrase-card ${bedsideMode ? "bedside-card" : ""}">
          <div class="card-top">
            <span class="sec-tag">${escapeHtml(p.section)}${p.subsection ? " · " + escapeHtml(p.subsection) : ""}</span>
            ${statusBadgeHtml(p.status)}
          </div>
          <h3 class="english-term">${escapeHtml(p.english)}</h3>
          <div class="idoma-row">
            <span class="idoma-term">${p.idoma ? escapeHtml(p.idoma) : "<em>No Idoma entry yet</em>"}</span>
            ${audioBtn}
          </div>
          ${p.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(p.syllables)}</code></div>` : ""}
          ${p.phonetic ? `<div class="meta-line"><strong>Pronunciation hint:</strong> ${escapeHtml(p.phonetic)}</div>` : ""}
          ${p.tone ? `<div class="tone-alert"><strong>Tone / Pitch note:</strong> ${escapeHtml(p.tone)}</div>` : ""}
          ${p.clinical ? `<div class="clinical-note"><strong>Clinical / Context note:</strong> ${escapeHtml(p.clinical)}</div>` : ""}
          <div class="card-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-suggest-edit="${escapeHtml(p.id)}">Suggest Edit / Audio Target</button>
          </div>
        </article>
      `;
    }).join("");

    listEl.querySelectorAll("[data-play-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-play-url");
        if (activeAudioEl) {
          activeAudioEl.pause();
        }
        activeAudioEl = new Audio(url);
        activeAudioEl.play().catch((e) => setStatusBanner("Could not play audio: " + e.message, "warn"));
      });
    });

    listEl.querySelectorAll("[data-suggest-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-suggest-edit");
        const target = phrases.find((x) => x.id === id);
        if (!target) return;
        switchTab("contributeTab");
        $("subType").value = "edit_phrase";
        $("subTargetId").value = target.id;
        $("subSection").value = target.section;
        $("subSubsection").value = target.subsection || "";
        $("subEnglish").value = target.english;
        $("subIdoma").value = target.idoma || "";
        $("subSyllables").value = target.syllables || "";
        $("subPhonetic").value = target.phonetic || "";
        $("subTone").value = target.tone || "";
        $("subClinical").value = target.clinical || "";
        $("audioPhraseSelect").value = target.id;
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function renderPracticeCard() {
    const cardEl = $("practiceCard");
    if (!cardEl) return;

    const translated = phrases.filter((p) => p.idoma && p.status !== "missing");
    const sections = Array.from(new Set(translated.map((p) => p.section).filter(Boolean)));
    const pool = practiceSection === "ALL"
      ? translated
      : translated.filter((p) => p.section === practiceSection);

    const directionLabel = practiceDirection === "en_to_id"
      ? "Direction: English → Idoma"
      : "Direction: Idoma → English";

    const controlsHtml = `
      <div class="practice-controls">
        <select id="practiceSectionSelect" aria-label="Filter practice cards by section" style="max-width:250px;">
          <option value="ALL">All Sections (${translated.length})</option>
          ${sections.map((s) => `<option value="${escapeHtml(s)}" ${s === practiceSection ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-sm btn-secondary" id="toggleDirectionBtn">${directionLabel}</button>
      </div>
    `;

    if (pool.length === 0) {
      cardEl.innerHTML = `
        <div class="practice-meta">
          ${controlsHtml}
          <span>Streak: <strong>${practiceStreak}</strong></span>
        </div>
        <p>No translated phrases available for this selection yet.</p>
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
      return;
    }

    const item = pool[practiceIndex % pool.length];
    const clip = audioMap[item.id];
    const isReverse = practiceDirection === "id_to_en";

    const promptText = isReverse ? item.idoma : item.english;
    const answerText = isReverse ? item.english : item.idoma;
    const promptInstruction = isReverse
      ? "Read or listen to the Idoma phrase and recall its English meaning and clinical context first, then reveal to check."
      : "Say or recall the Idoma phrase and pitch contour first, then reveal to check.";

    cardEl.innerHTML = `
      <div class="practice-meta">
        ${controlsHtml}
        <span>Card ${(practiceIndex % pool.length) + 1} of ${pool.length} · Streak: <strong>${practiceStreak}</strong></span>
      </div>
      <div class="sec-tag">${escapeHtml(item.section)}${item.subsection ? " · " + escapeHtml(item.subsection) : ""}</div>
      <h3 class="english-term">${escapeHtml(promptText)}</h3>
      ${isReverse && item.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(item.syllables)}</code></div>` : ""}
      ${isReverse && clip && clip.url ? `<div class="card-actions"><button type="button" class="btn btn-sm btn-secondary" id="practicePlayAudio">Play Approved Audio</button></div>` : ""}
      <p class="muted">${promptInstruction}</p>
      ${practiceRevealed ? `
        <div class="reveal-box">
          <div class="idoma-term">${escapeHtml(answerText)}</div>
          ${!isReverse && item.syllables ? `<div class="meta-line"><strong>Syllables:</strong> <code>${escapeHtml(item.syllables)}</code></div>` : ""}
          ${item.phonetic ? `<div class="meta-line"><strong>Pronunciation hint:</strong> ${escapeHtml(item.phonetic)}</div>` : ""}
          ${item.tone ? `<div class="tone-alert">${escapeHtml(item.tone)}</div>` : ""}
          ${item.clinical ? `<div class="clinical-note">${escapeHtml(item.clinical)}</div>` : ""}
          ${!isReverse && clip && clip.url ? `<div class="card-actions"><button type="button" class="btn btn-sm btn-secondary" id="practicePlayAudio">Play Approved Audio</button></div>` : ""}
        </div>
        <div class="practice-buttons">
          <button type="button" class="btn btn-primary" id="markRecalledBtn">Recalled Well (+1 Streak)</button>
          <button type="button" class="btn btn-secondary" id="needsReviewBtn">Needs More Practice</button>
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
        ${c.notes ? `<p class="muted small-note">${escapeHtml(c.notes)}</p>` : ""}
      </div>
    `).join("");
  }

  function populateAudioPhraseSelect() {
    const sel = $("audioPhraseSelect");
    if (!sel) return;
    sel.innerHTML = phrases
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.english)}${p.idoma ? " — " + escapeHtml(p.idoma) : " [Blank]"}</option>`)
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
      const pendingSubs = data.submissions.filter((s) => s.review_status === "pending");
      const pendingAudio = data.audioClips.filter((a) => a.approval_status === "pending");

      container.innerHTML = `
        <div class="admin-grid">
          <section class="panel">
            <h3>1. Contributors, Access Codes & Credits</h3>
            <form id="contribForm" class="stack-form">
              <input type="hidden" id="cId" />
              <div class="two-col">
                <label>Full Name <input type="text" id="cName" required placeholder="e.g. Grace Adini" /></label>
                <label>Role Title <input type="text" id="cRole" required placeholder="e.g. Translation" /></label>
              </div>
              <div class="two-col">
                <label>Access Code <input type="text" id="cCode" required placeholder="e.g. CONT-NEW-02" /></label>
                <label>Notes <input type="text" id="cNotes" placeholder="Dialect / specialty notes" /></label>
              </div>
              <div class="two-col">
                <label>Daily Phrase Limit <input type="number" id="cSubLimit" value="40" min="1" max="500" /></label>
                <label>Daily Audio Limit <input type="number" id="cAudLimit" value="40" min="1" max="500" /></label>
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
                  <tr><th>Name</th><th>Role</th><th>Code</th><th>Limits</th><th>Credits</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  ${data.contributors.map((c) => `
                    <tr>
                      <td><strong>${escapeHtml(c.full_name)}</strong>${c.is_admin ? " <span class='badge badge-verified'>Admin</span>" : ""}</td>
                      <td>${escapeHtml(c.role_title)}</td>
                      <td><code>${escapeHtml(c.access_code)}</code></td>
                      <td>${c.daily_submission_limit}p / ${c.daily_audio_limit}a</td>
                      <td>${c.show_in_credits ? "Yes" : "No"}</td>
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
            <h3>2. Pending Phrase Edits & Term Requests (${pendingSubs.length})</h3>
            ${pendingSubs.length === 0 ? "<p class='muted'>No pending phrase submissions.</p>" : pendingSubs.map((s) => `
              <div class="mod-item">
                <div class="card-top">
                  <span class="sec-tag">${escapeHtml(s.submission_type)} · ${escapeHtml(s.section)}</span>
                  <span class="muted small-note">By ${escapeHtml(s.requester_label || "User")}</span>
                </div>
                <strong>English:</strong> ${escapeHtml(s.english_term)}<br/>
                ${s.idoma_term ? `<strong>Proposed Idoma:</strong> ${escapeHtml(s.idoma_term)}<br/>` : ""}
                ${s.syllables ? `<strong>Syllables:</strong> <code>${escapeHtml(s.syllables)}</code><br/>` : ""}
                ${s.tone_note ? `<strong>Tone note:</strong> ${escapeHtml(s.tone_note)}<br/>` : ""}
                ${s.clinical_note ? `<strong>Notes:</strong> ${escapeHtml(s.clinical_note)}<br/>` : ""}
                <div class="btn-row">
                  <button type="button" class="btn btn-sm btn-primary" data-sub-action="approved" data-sub-id="${escapeHtml(s.id)}">Approve & Publish</button>
                  <button type="button" class="btn btn-sm btn-danger" data-sub-action="rejected" data-sub-id="${escapeHtml(s.id)}">Reject</button>
                </div>
              </div>
            `).join("")}

            <h3 class="mt-lg">3. Pending Audio Clips (${pendingAudio.length})</h3>
            ${pendingAudio.length === 0 ? "<p class='muted'>No pending voice clips.</p>" : pendingAudio.map((a) => {
              const phrase = phrases.find((p) => p.id === a.phrase_id);
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
            daily_submission_limit: Number($("cSubLimit").value) || 40,
            daily_audio_limit: Number($("cAudLimit").value) || 40,
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

      container.querySelectorAll("[data-edit-c]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const found = data.contributors.find((x) => x.id === btn.getAttribute("data-edit-c"));
          if (!found) return;
          $("cId").value = found.id;
          $("cName").value = found.full_name || "";
          $("cRole").value = found.role_title || "";
          $("cCode").value = found.access_code || "";
          $("cNotes").value = found.notes || "";
          $("cSubLimit").value = found.daily_submission_limit || 40;
          $("cAudLimit").value = found.daily_audio_limit || 40;
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
            populateSectionFilter();
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
    if (tabId === "practiceTab") renderPracticeCard();
    if (tabId === "contributeTab") renderContributeGuestNotice();
    if (tabId === "adminTab") renderAdminDashboard();
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    $("searchInput")?.addEventListener("input", renderPhrases);
    $("sectionFilter")?.addEventListener("change", (e) => {
      activeSection = e.target.value;
      renderPhrases();
    });
    $("statusFilter")?.addEventListener("change", (e) => {
      activeStatus = e.target.value;
      renderPhrases();
    });

    $("bedsideToggleBtn")?.addEventListener("click", () => {
      bedsideMode = !bedsideMode;
      $("bedsideToggleBtn").textContent = bedsideMode ? "Exit Bedside Mode" : "Bedside High-Contrast Mode";
      document.body.classList.toggle("bedside-active", bedsideMode);
      renderPhrases();
    });

    $("loginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        session = await DB.loginWithCode($("accessCodeInput").value);
        $("accessCodeInput").value = "";
        loginExpanded = false;
        renderSessionBadge();
        setStatusBanner(`Welcome, ${session.full_name}.`, "success");
        if (session.is_admin) await renderAdminDashboard();
      } catch (err) {
        setStatusBanner(err.message, "warn");
      }
    });

    $("logoutBtn")?.addEventListener("click", () => {
      DB.clearSavedSession();
      session = null;
      renderSessionBadge();
      switchTab("finderTab");
      setStatusBanner("Signed out.", "info");
    });

    $("phraseSubForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const englishVal = $("subEnglish").value.trim();
        if (!englishVal) throw new Error("English term or question is required.");

        const subType = session ? $("subType").value : "term_request";
        await DB.submitPhraseOrRequest({
          submission_type: subType,
          target_phrase_id: subType === "edit_phrase" ? ($("subTargetId").value || null) : null,
          variation_of_id: $("subVariationOf").value || null,
          allow_variation: $("subAllowVar").checked,
          section: $("subSection").value,
          subsection: $("subSubsection").value.trim(),
          english_term: englishVal,
          idoma_term: $("subIdoma").value.trim(),
          syllables: $("subSyllables").value.trim(),
          phonetic_hint: $("subPhonetic").value.trim(),
          tone_note: $("subTone").value.trim(),
          clinical_note: $("subClinical").value.trim(),
          proposed_status: $("subStatus").value,
          requester_label: $("subRequester")?.value.trim() || "Public user"
        }, session);

        $("phraseSubForm").reset();
        $("subTargetId").value = "";
        setStatusBanner(
          session
            ? "Submitted to the moderation queue for Admin approval."
            : "Term request submitted! An admin/contributor can review it in the queue.",
          "success"
        );
        if (session && session.is_admin) await renderAdminDashboard();
      } catch (err) {
        setStatusBanner(err.message, "warn");
      }
    });

    $("recordToggleBtn")?.addEventListener("click", async () => {
      try {
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
          $("listenStatus").textContent = "Comparing against known phrase patterns (unverified acoustic match — confirm with patient):";
          const matches = await Matcher.matchPatientSpeech(rec.blob, phrases, audioMap);
          $("listenMatches").innerHTML = matches.map((m) => `
            <div class="match-card">
              <div>
                <strong>${escapeHtml(m.phrase.english)}</strong> — <span class="idoma-term">${escapeHtml(m.phrase.idoma)}</span>
                <div class="muted small-note">Candidate match score: ${m.confidence}% · Confirm directly with patient</div>
              </div>
              ${m.hasAudio ? `<button type="button" class="btn btn-sm btn-secondary" data-match-play="${escapeHtml(audioMap[m.phrase.id].url)}">Hear Reference</button>` : ""}
            </div>
          `).join("");
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
          entry.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — Confirmed response: ${val}`;
          log.prepend(entry);
        }
      });
    });
  }

  async function init() {
    bindEvents();
    DB.initClient();
    session = DB.getSavedSession();
    renderSessionBadge();

    seedPhrases = await DB.loadSeedPhrases();
    const fetched = await DB.fetchPhrases(seedPhrases);
    phrases = fetched.phrases;
    audioMap = await DB.fetchApprovedAudioMap();
    credits = await DB.fetchPublicCredits();

    populateSectionFilter();
    populateAudioPhraseSelect();
    renderPhrases();
    renderPracticeCard();
    renderCredits();

    if (DB.isLive()) {
      setStatusBanner(`Connected to Supabase (${phrases.length} entries loaded).`, "success");
    } else {
      setStatusBanner(`Offline / Local mode (${phrases.length} entries loaded from seed/local storage). Add Supabase URL & anon key in js/config.js when ready.`, "info");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
