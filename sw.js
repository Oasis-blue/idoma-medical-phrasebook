const CACHE_NAME = "idoma-med-shell-v16.2";
const AUDIO_CACHE = "idoma-med-audio-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/config.js",
  "./js/db.js",
  "./js/audio-matcher.js",
  "./js/clinical-search.js",
  "./js/app.js",
  "./data/seed-phrases.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  // No skipWaiting here: the page shows an "Update available" bar and sends SKIP_WAITING when tapped.
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== AUDIO_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. Cache approved audio files on first playback for offline ward use
  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return new Response("", { status: 503, statusText: "Audio offline" });
        }
      })
    );
    return;
  }

  // 2. Network-first for Supabase REST queries with safe cache/offline fallback
  if (url.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || new Response(JSON.stringify([]), {
            status: 503,
            statusText: "Supabase offline",
            headers: { "Content-Type": "application/json" }
          });
        })
    );
    return;
  }

  // 3. Stale-while-revalidate for local app shell & seed JSON
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(async (cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
            }
            return res;
          })
          .catch(() => null);

        if (cached) return cached;
        const fresh = await networkFetch;
        return fresh || new Response("Offline", { status: 503, statusText: "Offline" });
      })
    );
  }
});
