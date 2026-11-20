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

  // Decode any audio Blob into a normalized mono Float32Array (16kHz target)
  async function decodeAndTrim(blob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const arrayBuf = await blob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      const raw = audioBuf.getChannelData(0);

      // Trim leading & trailing silence so word alignment is tight
      const threshold = 0.015;
      let start = 0;
      let end = raw.length - 1;
      while (start < end && Math.abs(raw[start]) < threshold) start++;
      while (end > start && Math.abs(raw[end]) < threshold) end--;

      const trimmed = raw.slice(Math.max(0, start - 800), Math.min(raw.length, end + 800));
      if (trimmed.length < 400) return raw;

      // Peak-normalize volume so soft-spoken patients match loud recordings
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

  // Extract 12-band log-mel energy frames (lightweight MFCC-style spectral envelope)
  function extractSpectralFrames(samples, sampleRate = 44100) {
    const frameSize = 1024;
    const hopSize = 512;
    const numBands = 12;
    const frames = [];

    for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
      // Apply Hamming window & compute energy in log-spaced frequency bands
      const bandEnergies = new Float32Array(numBands);
      for (let b = 0; b < numBands; b++) {
        // Goertzel-like bin sampling across vocal formant range (120Hz - 3800Hz)
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

      // Normalize frame vector (cepstral mean subtraction per frame)
      let mean = 0;
      for (let b = 0; b < numBands; b++) mean += bandEnergies[b];
      mean /= numBands;
      for (let b = 0; b < numBands; b++) bandEnergies[b] -= mean;

      frames.push(bandEnergies);
    }
    return frames;
  }

  // Dynamic Time Warping distance between two frame sequences
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

  // Cache reference fingerprints in memory so repeated ward queries are instant
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

  async function matchPatientSpeech(patientBlob, candidatePhrases, audioMap) {
    const withAudio = candidatePhrases.filter((p) => audioMap[p.id] && audioMap[p.id].url);
    if (withAudio.length === 0) {
      return [];
    }

    const patientSamples = await decodeAndTrim(patientBlob);
    const patientFrames = extractSpectralFrames(patientSamples);

    const scored = [];
    for (const phrase of withAudio) {
      try {
        const refFrames = await getReferenceFrames(phrase.id, audioMap[phrase.id].url);
        const dist = dtwDistance(patientFrames, refFrames);
        scored.push({ phrase, dist, hasAudio: true });
      } catch {
        // Skip unreadable audio clip
      }
    }

        scored.sort((a, b) => a.dist - b.dist);
    if (scored.length === 0) return [];

    // Reject if the patient audio was too short/silent or acoustically far from all clips
    const MAX_ACCEPTABLE_DIST = 1.65;
    if (patientFrames.length < 3 || scored[0].dist > MAX_ACCEPTABLE_DIST) {
      return [];
    }

    // Score based on both absolute acoustic closeness and relative separation
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
          hasAudio: true
        };
      });
  }
