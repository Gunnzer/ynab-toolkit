// Service worker: what makes the toolkit installable as a phone app, and
// lets it open without a connection.
//
// Network first, cache as the fallback: online, every file comes straight
// from the site (so a push shows up immediately, never a stale copy);
// offline, the last copy seen is used. Only this site's own files are ever
// cached - requests to YNAB's API are on another origin and are left
// completely alone, so no budget data is ever stored here.

const CACHE = "ynab-toolkit-v2";

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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The card details are fetched with a changing ?v= to get past GitHub's
  // servers' copy (card_feed.js); kept under one name so the offline copy
  // is always the latest one and old ones do not pile up.
  const key = url.pathname.endsWith("/data/cards.json") ? url.origin + url.pathname : request;

  // "no-cache" makes the browser check with the site every time instead of
  // reusing its own copy: GitHub Pages lets files be reused for 10 minutes,
  // so a plain fetch here showed a page up to 10 minutes stale after a
  // push (reported live). An unchanged file costs a tiny "not modified".
  // A page load cannot be re-issued with options, so it goes by its URL.
  const fresh = request.mode === "navigate"
    ? fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
    : fetch(request, { cache: "no-cache" });

  event.respondWith(
    fresh
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(() => caches.match(key)
        .then((hit) => hit || caches.match("./index.html"))));
});
