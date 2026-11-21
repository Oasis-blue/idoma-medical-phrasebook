(function () {
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStartTime = 0;

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone access is not supported on this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recordStartTime = Date.now();
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start();
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) return reject(new Error("No active recording."));
      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunks, { type: mimeType });
        const durationMs = Date.now() - recordStartTime;
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        mediaRecorder = null;
        resolve({ blob, mimeType, durationMs });
      };
      mediaRecorder.stop();
    });
  }

  // --- Cloud OmniASR / MMS Transcription via Gradio API ---
  async function transcribeViaMMS(patientBlob) {
    const baseUrl = (window.APP_CONFIG?.IDOMA_ASR_URL || "").replace(/\/+$/, "");
    if (!baseUrl) return { transcript: null, error: "IDOMA_ASR_URL is empty in js/config.js" };
    if (!navigator.onLine) return { transcript: null, error: "Device is offline" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    try {
      // 1. Upload audio blob to Gradio server
      const form = new FormData();
      form.append("files", patientBlob, "patient.webm");

      const uploadRes = await fetch(`${baseUrl}/gradio_api/upload`, {
        method: "POST",
        body: form,
        signal: controller.signal
      });
      if (!uploadRes.ok) {
        return { transcript: null, error: `Gradio upload failed (${uploadRes.status}) — check if Colab link expired` };
      }
      const uploadedPaths = await uploadRes.json();
      const serverPath = Array.isArray(uploadedPaths) ? uploadedPaths[0] : null;
      if (!serverPath) return { transcript: null, error: "Gradio upload returned no file path" };

      const payload = JSON.stringify({
        data: [{ path: serverPath, meta: { _type: "gradio.FileData" } }]
      });

      // 2. Gradio 5+ names the endpoint after the Python fn (/transcribe_idoma), fallback to /predict
      let endpoint = "transcribe_idoma";
      let callRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal
      });

      if (callRes.status === 404) {
        endpoint = "predict";
        callRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal
        });
      }

      if (!callRes.ok) {
        return { transcript: null, error: `Gradio call failed (${callRes.status})` };
      }

      const { event_id } = await callRes.json();
      if (!event_id) return { transcript: null, error: "Gradio returned no event_id" };

      // 3. Read SSE stream and grab the final completed data payload
      const resultRes = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${event_id}`, {
        signal: controller.signal
      });
      const sseText = await resultRes.text();

      if (sseText.includes("event: error")) {
        return { transcript: null, error: "Colab model threw an error processing audio (check Colab logs)" };
      }

      const dataLines = sseText
        .split("\n")
        .filter((l) => l.startsWith("data: ") && l !== "data: null");
      const lastDataLine = dataLines[dataLines.length - 1];
      if (!lastDataLine) return { transcript: null, error: "Gradio returned empty transcription" };

      const parsed = JSON.parse(lastDataLine.slice(6));
      const transcript = Array.isArray(parsed) ? String(parsed[0] || "").trim() : "";
      return { transcript: transcript || null, error: transcript ? null : "Model heard silence or unrecognized audio" };
    } catch (err) {
      return {
        transcript: null,
        error: err.name === "AbortError"
          ? "Colab timed out (25s) — server may be asleep"
          : `Could not reach Colab (${err.message})`
      };
    } finally {
      clearTimeout(timer);
    }
  }
  // --- Local Offline MFCC + DTW Acoustic Fingerprinting ---
  async function decodeAndTrim(blob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const arrayBuf = await blob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      const raw = audioBuf.getChannelData(0);

      const threshold = 0.015;
      let start = 0;
      let end = raw.length - 1;
      while (start < end && Math.abs(raw[start]) < threshold) start++;
      while (end > start && Math.abs(raw[end]) < threshold) end--;

      const trimmed = raw.slice(Math.max(0, start - 800), Math.min(raw.length, end + 800));
      if (trimmed.length < 400) return raw;

      let maxAmp = 0;
      for (let i = 0; i < trimmed.length; i++) {
        const a = Math.abs(trimmed[i]);
        if (a > maxAmp) maxAmp = a;
      }
      if (maxAmp > 0) {
        for (let i = 0; i < trimmed.length; i++) trimmed[i] /= maxAmp;
      }
      return trimmed;
    } finally {
      await ctx.close();
    }
  }

  function extractSpectralFrames(samples, sampleRate = 44100) {
    const frameSize = 1024;
    const hopSize = 512;
    const numBands = 12;
    const frames = [];

    for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
      const bandEnergies = new Float32Array(numBands);
      for (let b = 0; b < numBands; b++) {
        const freq = 120 * Math.pow(32, b / (numBands - 1));
        const k = Math.round((frameSize * freq) / sampleRate);
        const w = (2 * Math.PI * k) / frameSize;
        const cosW = Math.cos(w);
        const sinW = Math.sin(w);
        let q0 = 0, q1 = 0, q2 = 0;

        for (let n = 0; n < frameSize; n++) {
          const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (frameSize - 1));
          q0 = 2 * cosW * q1 - q2 + samples[offset + n] * win;
          q2 = q1;
          q1 = q0;
        }
        const real = q1 - q2 * cosW;
        const imag = q2 * sinW;
        bandEnergies[b] = Math.log10(1 + Math.sqrt(real * real + imag * imag));
      }

      let mean = 0;
      for (let b = 0; b < numBands; b++) mean += bandEnergies[b];
      mean /= numBands;
      for (let b = 0; b < numBands; b++) bandEnergies[b] -= mean;

      frames.push(bandEnergies);
    }
    return frames;
  }

  function dtwDistance(seqA, seqB) {
    const n = seqA.length;
    const m = seqB.length;
    if (n === 0 || m === 0) return Infinity;

    const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
    dp[0][0] = 0;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let dist = 0;
        const a = seqA[i - 1];
        const b = seqB[j - 1];
        for (let k = 0; k < a.length; k++) {
          const diff = a[k] - b[k];
          dist += diff * diff;
        }
        dist = Math.sqrt(dist);
        const minPrev = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        dp[i][j] = dist + minPrev;
      }
    }
    return dp[n][m] / (n + m);
  }

  const refFingerprintCache = new Map();

  async function getReferenceFrames(phraseId, audioUrl) {
    if (refFingerprintCache.has(audioUrl)) return refFingerprintCache.get(audioUrl);
    const res = await fetch(audioUrl);
    const blob = await res.blob();
    const samples = await decodeAndTrim(blob);
    const frames = extractSpectralFrames(samples);
    refFingerprintCache.set(audioUrl, frames);
    return frames;
  }

  async function matchViaLocalDTW(patientBlob, candidatePhrases, audioMap) {
    const withAudio = candidatePhrases.filter((p) => audioMap[p.id] && audioMap[p.id].url);
    if (withAudio.length === 0) return [];

    const patientSamples = await decodeAndTrim(patientBlob);
    const patientFrames = extractSpectralFrames(patientSamples);

    const scored = [];
    for (const phrase of withAudio) {
      try {
        const refFrames = await getReferenceFrames(phrase.id, audioMap[phrase.id].url);
        const dist = dtwDistance(patientFrames, refFrames);
        scored.push({ phrase, dist });
      } catch {
        // Skip unreadable clip
      }
    }

    scored.sort((a, b) => a.dist - b.dist);
    if (scored.length === 0) return [];

    const MAX_ACCEPTABLE_DIST = 1.65;
    if (patientFrames.length < 3 || scored[0].dist > MAX_ACCEPTABLE_DIST) {
      return [];
    }

    const bestDist = scored[0].dist;
    return scored
      .filter((item) => item.dist <= MAX_ACCEPTABLE_DIST)
      .slice(0, 3)
      .map((item) => {
        const absScore = Math.max(0, 1 - item.dist / (MAX_ACCEPTABLE_DIST * 1.15));
        const relScore = bestDist / Math.max(item.dist, 0.001);
        const confidence = Math.max(30, Math.min(95, Math.round((absScore * 0.55 + relScore * 0.45) * 100)));
        return {
          phrase: item.phrase,
          confidence,
          hasAudio: Boolean(audioMap[item.phrase.id]?.url),
          engine: "offline-dtw"
        };
      });
  }

 async function matchPatientSpeech(patientBlob, candidatePhrases, audioMap) {
    // 1. Try cloud OmniASR speech recognition first if configured & online
    const asr = await transcribeViaMMS(patientBlob);
    if (asr.transcript && window.ClinicalSearch) {
      const ranked = window.ClinicalSearch.searchAndRank(candidatePhrases, asr.transcript);
      const matches = ranked.slice(0, 3).map((r) => ({
        phrase: r.phrase,
        confidence: Math.min(95, Math.max(45, r.score)),
        hasAudio: Boolean(audioMap[r.phrase.id]?.url),
        transcript: asr.transcript,
        engine: "omniasr"
      }));
      return { transcript: asr.transcript, asrError: null, engine: "omniasr", matches };
    }

    // 2. Fallback to offline MFCC + DTW acoustic matching
    const dtwMatches = await matchViaLocalDTW(patientBlob, candidatePhrases, audioMap);
    return { transcript: null, asrError: asr.error, engine: "offline-dtw", matches: dtwMatches };
  }
    // 2. Fallback to offline MFCC + DTW acoustic matching
    const dtwMatches = await matchViaLocalDTW(patientBlob, candidatePhrases, audioMap);
    return { transcript: null, engine: "offline-dtw", matches: dtwMatches };
  }

  window.AudioMatcher = {
    startRecording,
    stopRecording,
    matchPatientSpeech
  };
})();
