// Service worker: what makes the toolkit installable as a phone app, and
// lets it open without a connection.
//
// Network first, cache as the fallback: online, every file comes straight
// from the site (so a push shows up immediately, never a stale copy);
// offline, the last copy seen is used. Only this site's own files are ever
// cached - requests to YNAB's API are on another origin and are left
// completely alone, so no budget data is ever stored here.

const CACHE = "ynab-toolkit-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)
        .then((hit) => hit || caches.match("./index.html"))));
});
