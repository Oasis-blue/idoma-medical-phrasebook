// Main Application Engine

let phrases = [];
let bedsideTray = new Set();
let audioRecordings = {};
let registeredContributors = [];
let requestedQueue = [];

let currentTab = 'finder';
let currentCategory = 'All';
let currentStatusFilter = 'all';
let currentSearchQuery = '';
let isBedsideFocus = false;
let currentUserRole = 'admin';

// Drill State
let drillIndex = 0;
let drillStreak = 0;
let drillQueue = [];

// Mic State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingTimerInt = null;
let recordedBlobUrl = null;

// App Startup
window.onload = async function() {
    await initAppPhrases();
    await renderDynamicCredits();
    renderCategoryPills();
    renderPhrases();
    populateStudioDropdown();
    renderContributorsList();
    initDrillSession();
};

async function initAppPhrases() {
    const fetched = await dbFetchPhrases();
    if (fetched && fetched.length > 0) {
        phrases = fetched;
    } else {
        // Load fallback seed data from seed-phrases.json or window fallback
        try {
            const res = await fetch('data/seed-phrases.json');
            phrases = await res.json();
        } catch(e) {
            console.error("Seed fetch error:", e);
        }
    }
}

async function renderDynamicCredits() {
    const contributors = await dbFetchContributors();
    registeredContributors = contributors;
    const container = document.getElementById('dynamic-credits-container');
    if (!container) return;

    container.innerHTML = `
        <div class="border border-slate-200 rounded-xl overflow-hidden">
            <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr><th class="p-2.5">Name</th><th class="p-2.5">Contribution</th></tr>
                </thead>
                <tbody class="divide-y divide-slate-100 text-slate-700">
                    ${contributors.map(c => `<tr><td class="p-2.5 font-medium">${c.full_name}</td><td class="p-2.5">${c.role_title}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function switchTab(tabId) {
    currentTab = tabId;
    ['finder', 'listen', 'tray', 'practice', 'studio', 'admin'].forEach(t => {
        const view = document.getElementById(`view-${t}`);
        const nav = document.getElementById(`nav-${t}`);
        if (view) view.classList.toggle('hidden', t !== tabId);
        if (nav) {
            if (t === tabId) {
                nav.className = "px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold transition-all shadow-sm";
            } else {
                nav.className = "px-3 py-1.5 rounded-lg hover:bg-emerald-800/60 transition-all text-emerald-200";
            }
        }
    });

    if (tabId === 'tray') renderTrayCards();
    if (tabId === 'practice') showCurrentDrillCard();
}

function renderCategoryPills() {
    const categories = ['All', ...new Set(phrases.map(p => p.category))];
    const container = document.getElementById('category-pills');
    container.innerHTML = categories.map(cat => `
        <button onclick="selectCategory('${cat}')" 
            class="px-3 py-1.5 rounded-xl border text-xs whitespace-nowrap transition-all font-medium ${currentCategory === cat ? 'bg-emerald-700 text-white border-emerald-700 shadow-sm' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}">
            ${cat}
        </button>
    `).join('');
}

function selectCategory(cat) {
    currentCategory = cat;
    renderCategoryPills();
    renderPhrases();
}

function selectStatusFilter(status) {
    currentStatusFilter = status;
    renderPhrases();
}

function handleSearch() {
    const input = document.getElementById('search-input');
    currentSearchQuery = input.value.trim().toLowerCase();
    document.getElementById('search-clear-btn').classList.toggle('hidden', currentSearchQuery === '');
    renderPhrases();
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    currentSearchQuery = '';
    document.getElementById('search-clear-btn').classList.add('hidden');
    renderPhrases();
}

function renderPhrases() {
    const container = document.getElementById('phrase-cards-container');
    const fallbackNotice = document.getElementById('smart-fallback-notice');

    let filtered = phrases.filter(p => {
        const matchesCat = currentCategory === 'All' || p.category === currentCategory;
        const matchesSearch = currentSearchQuery === '' || 
            p.english.toLowerCase().includes(currentSearchQuery) || 
            (p.idoma && p.idoma.toLowerCase().includes(currentSearchQuery)) ||
            (p.syllables && p.syllables.toLowerCase().includes(currentSearchQuery));
        
        let matchesStatus = true;
        if (currentStatusFilter === 'verified') matchesStatus = p.verificationStatus === 'verified';
        if (currentStatusFilter === 'unconfirmed') matchesStatus = p.verificationStatus === 'unconfirmed' || (p.idoma && p.idoma.includes('?'));
        if (currentStatusFilter === 'missing') matchesStatus = p.verificationStatus === 'missing' || !p.idoma;

        return matchesCat && matchesSearch && matchesStatus;
    });

    document.getElementById('results-count').innerText = filtered.length;

    if (filtered.length === 0 && currentSearchQuery !== '') {
        fallbackNotice.classList.remove('hidden');
        document.getElementById('fallback-query-text').innerText = currentSearchQuery;
        document.getElementById('fallback-btn-text').innerText = currentSearchQuery;
    } else {
        fallbackNotice.classList.add('hidden');
    }

    container.innerHTML = filtered.map(p => createPhraseCardHTML(p)).join('');
}

function createPhraseCardHTML(p) {
    const isBookmarked = bedsideTray.has(p.id);
    const hasAudio = !!audioRecordings[p.id];

    let badgeHTML = p.verificationStatus === 'verified' ?
        `<span class="bg-emerald-100 text-emerald-900 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">Verified</span>` :
        `<span class="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300">Unconfirmed</span>`;

    return `
        <div class="card-bg bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs">
                    <span class="text-slate-400 font-medium text-muted">${p.category}</span>
                    ${badgeHTML}
                </div>
                <div>
                    <h3 class="text-sm font-bold text-slate-800 leading-snug">${p.english}</h3>
                    <p class="idoma-text text-lg font-extrabold text-emerald-700 mt-1">${p.idoma || '[Pending]'}</p>
                    ${p.syllables ? `<p class="text-xs text-emerald-800 font-mono mt-0.5">${p.syllables}</p>` : ''}
                </div>
                ${p.toneNote ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-2 text-xs text-amber-900"><strong>Tone:</strong> ${p.toneNote}</div>` : ''}
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <button onclick="playPronunciation(${p.id})" class="text-sky-600 font-semibold flex items-center gap-1.5 bg-sky-50 px-3 py-1.5 rounded-xl">
                    <i class="fa-solid fa-volume-high"></i> Audio Cue
                </button>
                <button onclick="toggleBookmark(${p.id})" class="p-2 rounded-xl border ${isBookmarked ? 'bg-amber-100 text-amber-800' : 'border-slate-200 text-slate-400'}">
                    <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
                </button>
            </div>
        </div>
    `;
}

function toggleBookmark(id) {
    if (bedsideTray.has(id)) bedsideTray.delete(id);
    else bedsideTray.add(id);
    document.getElementById('tray-count-badge').innerText = bedsideTray.size;
    renderPhrases();
}

function clearTray() {
    bedsideTray.clear();
    document.getElementById('tray-count-badge').innerText = 0;
    renderTrayCards();
}

function renderTrayCards() {
    const container = document.getElementById('tray-cards-container');
    const emptyState = document.getElementById('tray-empty-state');
    const pinnedList = phrases.filter(p => bedsideTray.has(p.id));

    if (pinnedList.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        container.innerHTML = pinnedList.map(p => createPhraseCardHTML(p)).join('');
    }
}

// Drills Active Recall
function initDrillSession() {
    drillQueue = phrases.filter(p => p.idoma && p.idoma.trim() !== '');
    drillIndex = 0;
}

function showCurrentDrillCard() {
    if (!drillQueue || drillQueue.length === 0) return;
    const current = drillQueue[drillIndex % drillQueue.length];

    document.getElementById('drill-category').innerText = current.category;
    document.getElementById('drill-progress').innerText = `Card ${(drillIndex % drillQueue.length) + 1} / ${drillQueue.length}`;
    document.getElementById('drill-prompt-english').innerText = current.english;
    document.getElementById('drill-answer-idoma').innerText = current.idoma;
    document.getElementById('drill-answer-syllables').innerText = current.syllables ? `Syllables: ${current.syllables}` : '';
    
    document.getElementById('drill-answer-box').classList.add('hidden');
    document.getElementById('drill-actions-reveal').classList.remove('hidden');
    document.getElementById('drill-actions-grade').classList.add('hidden');
}

function revealDrillAnswer() {
    document.getElementById('drill-answer-box').classList.remove('hidden');
    document.getElementById('drill-actions-reveal').classList.add('hidden');
    document.getElementById('drill-actions-grade').classList.remove('hidden');
}

function gradeDrill(success) {
    if (success) drillStreak++;
    else drillStreak = 0;
    document.getElementById('drill-streak').innerText = drillStreak;
    drillIndex++;
    showCurrentDrillCard();
}

// Studio & Data Export
function populateStudioDropdown() {
    const select = document.getElementById('studio-phrase-select');
    select.innerHTML = phrases.map(p => `<option value="${p.id}">${p.english} (${p.idoma || 'Pending'})</option>`).join('');
    loadSelectedPhraseToEditor();
}

function loadSelectedPhraseToEditor() {
    const id = parseInt(document.getElementById('studio-phrase-select').value);
    const p = phrases.find(item => item.id === id);
    if (!p) return;
    document.getElementById('edit-field-idoma').value = p.idoma || '';
    document.getElementById('edit-field-syllables').value = p.syllables || '';
    document.getElementById('edit-field-status').value = p.verificationStatus || 'verified';
    document.getElementById('edit-field-tonenote').value = p.toneNote || '';
}

function saveEntryEdits() {
    const id = parseInt(document.getElementById('studio-phrase-select').value);
    const p = phrases.find(item => item.id === id);
    if (!p) return;

    p.idoma = document.getElementById('edit-field-idoma').value.trim();
    p.syllables = document.getElementById('edit-field-syllables').value.trim();
    p.verificationStatus = document.getElementById('edit-field-status').value;
    p.toneNote = document.getElementById('edit-field-tonenote').value.trim();

    localStorage.setItem(LOCAL_STORAGE_KEY_PHRASES, JSON.stringify(phrases));
    renderPhrases();
    showToast("Edits Saved", `Updated entry for ${p.english}`);
}

function exportPhrasebookJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(phrases, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `idoma_phrasebook_${new Date().toISOString().substring(0,10)}.json`);
    dlAnchorElem.click();
}

function playPronunciation(id) {
    const p = phrases.find(item => item.id === id);
    if (!p) return;
    if ('speechSynthesis' in window && p.idoma) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(p.idoma);
        u.rate = 0.85;
        window.speechSynthesis.speak(u);
    }
    showToast(`Audio Cue: ${p.english}`, `${p.idoma || 'Pending'} (${p.notes || 'Verify tone aloud'})`);
}

function setUserRole(role) {
    currentUserRole = role;
    showToast("Role Updated", `Active view: ${role.toUpperCase()}`);
}

function generateContributorCode() {
    const name = document.getElementById('new-contributor-name').value.trim();
    const role = document.getElementById('new-contributor-role').value;
    if (!name) return;
    const code = `FUHSO-${name.split(' ')[0].toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    registeredContributors.push({ full_name: name, role_title: role, access_code: code });
    renderContributorsList();
    renderDynamicCredits();
    showToast("Access Code Registered", `${name}: ${code}`);
}

function renderContributorsList() {
    const container = document.getElementById('contributors-list-box');
    container.innerHTML = registeredContributors.map(c => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-white border">
            <div><span class="font-bold text-slate-800">${c.full_name}</span> <span class="text-[10px] text-slate-400 font-normal">(${c.role_title})</span></div>
            <span class="font-mono text-[10px] font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">${c.access_code}</span>
        </div>
    `).join('');
}

function runDuplicateCheck() {
    const query = document.getElementById('check-duplicate-term').value.trim().toLowerCase();
    const resBox = document.getElementById('duplicate-check-result');
    if (!query) return;

    const matches = phrases.filter(p => p.english.toLowerCase().includes(query));
    resBox.classList.remove('hidden');
    if (matches.length > 0) {
        resBox.className = "text-xs p-3 rounded-xl border bg-amber-50 border-amber-200 text-amber-900";
        resBox.innerHTML = `<strong>Found ${matches.length} Existing Match(es):</strong> ${matches.map(m => m.english).join(', ')}`;
    } else {
        resBox.className = "text-xs p-3 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 font-bold";
        resBox.innerText = "✓ No duplicates found. Safe for insertion!";
    }
}

function toggleBedsideFocus() {
    isBedsideFocus = !isBedsideFocus;
    document.body.classList.toggle('bedside-focus', isBedsideFocus);
}

function showToast(title, text) {
    const toast = document.getElementById('toast-audio');
    document.getElementById('toast-phrase-title').innerText = title;
    document.getElementById('toast-phrase-text').innerText = text;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function openCreditsModal() { document.getElementById('modal-credits').classList.remove('hidden'); }
function closeCreditsModal() { document.getElementById('modal-credits').classList.add('hidden'); }
function openRequestModal(term = '') {
    document.getElementById('modal-request').classList.remove('hidden');
    if (term) document.getElementById('request-input-term').value = term;
}
function closeRequestModal() { document.getElementById('modal-request').classList.add('hidden'); }
function dismissDisclaimer() { document.getElementById('disclaimer-banner').classList.add('hidden'); }

async function submitTermRequest(e) {
    e.preventDefault();
    const term = document.getElementById('request-input-term').value;
    const cat = document.getElementById('request-input-category').value;
    const note = document.getElementById('request-input-note').value;

    await dbSubmitTermRequest(term, cat, note);
    closeRequestModal();
    showToast("Term Requested", `'${term}' submitted to review queue.`);
}