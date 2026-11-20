(function () {
  // Bidirectional clinical & layperson synonym groups
  const SYNONYM_GROUPS = [
    ["pain", "ache", "aching", "hurt", "hurting", "sore", "tenderness", "throbbing", "sharp", "burning", "cramp", "cramps", "oho"],
    ["stomach", "abdomen", "abdominal", "belly", "tummy", "gut", "epigastric", "ipu"],
    ["headache", "head ache", "migraine", "head pain", "ikpeyi"],
    ["fever", "pyrexia", "hot", "hotness", "high temperature", "chills", "rigors", "shivering", "febrile"],
    ["vomit", "vomiting", "throw up", "throwing up", "emesis", "nausea", "nauseous", "queasy", "retching"],
    ["diarrhea", "diarrhoea", "loose stool", "watery stool", "running stomach", "frequent stool", "dysentery"],
    ["constipation", "hard stool", "cannot stool", "difficulty passing stool"],
    ["urine", "urinate", "urinating", "pee", "peeing", "micturition", "dysuria", "bladder", "incontinence"],
    ["blood", "bleeding", "hemorrhage", "haemorrhage", "bloody", "ebi"],
    ["cough", "coughing", "sputum", "phlegm", "chest congestion"],
    ["breath", "breathing", "breathe", "dyspnea", "dyspnoea", "shortness of breath", "wheezing", "suffocating", "asthma"],
    ["chest", "thorax", "rib", "ribs", "heart", "palpitation", "palpitations"],
    ["dizzy", "dizziness", "vertigo", "lightheaded", "faint", "fainting", "syncope", "spinning"],
    ["weak", "weakness", "tired", "fatigue", "exhausted", "lethargy", "malaise"],
    ["swelling", "swollen", "edema", "oedema", "lump", "mass", "bump"],
    ["rash", "itching", "itchy", "pruritus", "skin", "hives", "boil", "wound", "ulcer", "akpa"],
    ["pregnant", "pregnancy", "antenatal", "gestation", "miscarriage", "labor", "labour", "delivery"],
    ["period", "menstruation", "menstrual", "menses", "vaginal bleeding", "cycle"],
    ["medicine", "medication", "drug", "drugs", "tablet", "tablets", "pill", "pills", "injection", "allergy", "allergic"],
    ["sleep", "sleeping", "insomnia", "nightmare", "rest"],
    ["eat", "eating", "appetite", "anorexia", "food", "swallow", "swallowing", "dysphagia"],
    ["eye", "eyes", "vision", "sight", "blurry", "blind", "ear", "ears", "hearing", "deaf"],
    ["back", "waist", "spine", "lower back", "loin", "joint", "joints", "knee", "neck", "shoulder"],
    ["child", "baby", "infant", "pediatric", "paediatric", "kid", "toddler", "newborn"],
    ["emergency", "urgent", "danger", "red flag", "severe", "unconscious", "convulsion", "seizure", "fit", "fits"]
  ];

  // Build fast lookup map: term -> Set of related terms
  const synonymMap = new Map();
  for (const group of SYNONYM_GROUPS) {
    const normalizedGroup = group.map((t) => t.toLowerCase());
    for (const term of normalizedGroup) {
      if (!synonymMap.has(term)) synonymMap.set(term, new Set());
      for (const peer of normalizedGroup) {
        if (peer !== term) synonymMap.get(term).add(peer);
      }
    }
  }

  function normalizeText(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip tone diacritics for forgiving search
      .replace(/[^a-z0-9\s'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Lightweight Levenshtein distance for typo tolerance (e.g., ikpei -> ikpeyi)
  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > 2) return 3;

    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let curr = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  function getExpandedTerms(rawQuery) {
    const clean = normalizeText(rawQuery);
    if (!clean) return { direct: [], synonyms: [] };

    const directSet = new Set([clean]);
    const synonymSet = new Set();

    // Check full phrase synonyms first (e.g., "throwing up", "running stomach")
    if (synonymMap.has(clean)) {
      synonymMap.get(clean).forEach((s) => synonymSet.add(s));
    }

    const tokens = clean.split(" ").filter((w) => w.length >= 2);
    for (const tok of tokens) {
      directSet.add(tok);
      if (synonymMap.has(tok)) {
        synonymMap.get(tok).forEach((s) => synonymSet.add(s));
      }
    }

    // Remove direct terms from synonymSet so we can distinguish exact vs synonym matches
    directSet.forEach((d) => synonymSet.delete(d));

    return {
      direct: Array.from(directSet),
      synonyms: Array.from(synonymSet)
    };
  }

  function scorePhraseMatch(phrase, rawQuery) {
    const cleanQuery = normalizeText(rawQuery);
    if (!cleanQuery) return { matched: true, score: 1, matchedVia: null };

    const englishNorm = normalizeText(phrase.english);
    const idomaNorm = normalizeText(phrase.idoma);
    const alalaNorm = normalizeText(phrase.alala);
    const metaNorm = normalizeText([
      phrase.variationLabel,
      phrase.syllables,
      phrase.phonetic,
      phrase.tone,
      phrase.clinical,
      phrase.section,
      phrase.subsection
    ].join(" "));

    const fullHay = `${englishNorm} ${idomaNorm} ${alalaNorm} ${metaNorm}`;

    // 1. Exact substring match in English/Idoma/Alala (highest priority)
    if (englishNorm.includes(cleanQuery) || idomaNorm.includes(cleanQuery) || alalaNorm.includes(cleanQuery)) {
      return { matched: true, score: 100, matchedVia: null };
    }
    if (metaNorm.includes(cleanQuery)) {
      return { matched: true, score: 75, matchedVia: null };
    }

    const { direct, synonyms } = getExpandedTerms(cleanQuery);
    const queryWords = cleanQuery.split(" ").filter((w) => w.length >= 2);

    // 2. Multi-word AND match across fields
    if (queryWords.length > 1 && queryWords.every((w) => fullHay.includes(w))) {
      return { matched: true, score: 85, matchedVia: null };
    }

    // 3. Synonym expansion match (e.g., "belly" -> "abdomen")
    for (const syn of synonyms) {
      if (englishNorm.includes(syn) || idomaNorm.includes(syn) || alalaNorm.includes(syn)) {
        return { matched: true, score: 65, matchedVia: syn };
      }
      if (metaNorm.includes(syn)) {
        return { matched: true, score: 50, matchedVia: syn };
      }
    }

    // 4. Fuzzy typo match on words >= 4 chars (e.g., "ikpei" -> "ikpeyi")
    const hayWords = fullHay.split(" ").filter((w) => w.length >= 4);
    for (const qw of direct) {
      if (qw.length < 4) continue;
      for (const hw of hayWords) {
        if (editDistance(qw, hw) <= 1) {
          return { matched: true, score: 45, matchedVia: hw };
        }
      }
    }

    return { matched: false, score: 0, matchedVia: null };
  }

  function searchAndRank(phrases, rawQuery) {
    const clean = normalizeText(rawQuery);
    if (!clean) {
      return phrases.map((p) => ({ phrase: p, score: 1, matchedVia: null }));
    }

    const results = [];
    for (const p of phrases) {
      const res = scorePhraseMatch(p, clean);
      if (res.matched) {
        results.push({ phrase: p, score: res.score, matchedVia: res.matchedVia });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  window.ClinicalSearch = {
    searchAndRank,
    getExpandedTerms
  };
})();
