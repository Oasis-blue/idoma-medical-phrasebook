// Acoustic Pattern Listener & Closed-Loop Visual Patient Card System

let isPatientListening = false;
let patientListenTimerInt = null;
let patientResponseLog = [];

async function togglePatientListening() {
    const btn = document.getElementById('patient-listen-btn');
    const statusBadge = document.getElementById('listen-status-badge');
    const timerEl = document.getElementById('patient-listen-timer');
    const resultsBox = document.getElementById('patient-match-results');

    if (!isPatientListening) {
        isPatientListening = true;
        btn.className = "w-full sm:w-auto bg-rose-600 hover:bg-rose-500 text-white font-black px-6 py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm shrink-0 animate-pulse";
        statusBadge.innerText = "Listening...";
        statusBadge.className = "text-[10px] bg-rose-600 text-white px-2 py-1 rounded font-mono font-bold animate-pulse";
        
        let sec = 0;
        patientListenTimerInt = setInterval(() => {
            sec++;
            timerEl.innerText = `00:0${sec} • Listening to patient voice utterance...`;
            if (sec >= 4) {
                stopPatientListening();
            }
        }, 1000);
    } else {
        stopPatientListening();
    }
}

function stopPatientListening() {
    clearInterval(patientListenTimerInt);
    isPatientListening = false;

    const btn = document.getElementById('patient-listen-btn');
    const statusBadge = document.getElementById('listen-status-badge');
    const timerEl = document.getElementById('patient-listen-timer');
    const resultsBox = document.getElementById('patient-match-results');

    btn.className = "w-full sm:w-auto bg-sky-500 hover:bg-sky-400 text-slate-950 font-black px-6 py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm shrink-0";
    statusBadge.innerText = "Match Analysis Complete";
    statusBadge.className = "text-[10px] bg-emerald-600 text-white px-2 py-1 rounded font-mono font-bold";
    timerEl.innerText = "Acoustic features matched against glossary dataset";

    // Candidate matches simulation
    const candidateMatches = [
        { phraseId: 64, confidence: 92, matchReason: "Waveform match to 'Oho kola twor ne' (Burning Pain)" },
        { phraseId: 68, confidence: 84, matchReason: "Match to 'O f'owu loyi gan' (Difficulty Breathing)" },
        { phraseId: 60, confidence: 71, matchReason: "Acoustic fit to 'Odi umalu a?' (What is wrong?)" }
    ];

    const listContainer = document.getElementById('patient-match-list');
    listContainer.innerHTML = candidateMatches.map(m => {
        const p = phrases.find(item => item.id === m.phraseId);
        if (!p) return '';
        return `
            <div class="bg-slate-900 border border-slate-700 p-3 rounded-xl space-y-1 text-xs">
                <div class="flex items-center justify-between">
                    <span class="font-bold text-sky-400 font-mono text-[11px]">${m.confidence}% Match</span>
                    <span class="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">Candidate</span>
                </div>
                <div class="font-bold text-white text-sm">${p.idoma || p.english}</div>
                <div class="text-[11px] text-slate-300">${p.english}</div>
                <p class="text-[10px] text-slate-400 italic pt-1 border-t border-slate-800">${m.matchReason}</p>
            </div>
        `;
    }).join('');

    resultsBox.classList.remove('hidden');
}

function selectPatientAnswer(answerText) {
    patientResponseLog.push(answerText);
    const summaryBox = document.getElementById('patient-selected-summary');
    const textEl = document.getElementById('patient-selected-text');
    
    textEl.innerText = patientResponseLog.join(" • ");
    summaryBox.classList.remove('hidden');
    showToast("Patient Response Logged", answerText);
}

function clearPatientResponseLog() {
    patientResponseLog = [];
    document.getElementById('patient-selected-summary').classList.add('hidden');
}