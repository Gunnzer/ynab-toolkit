// The card details download, like an exchange rate feed: fetch
// data/cards.json from this same site whenever the page opens (at most
// every FEED_MAX_AGE_MS), keep the last
// good copy on the device, and fall back to it when offline or when a
// download is broken. A download that fails validateCatalogue() is never
// used. Same origin only, so the app still talks to nothing but YNAB and
// itself.
//
// fetchJson and storage are passed in so this stays testable without a
// browser.

import { setCatalogue } from "./card_catalogue.js";
import { validateCatalogue } from "./card_rewards.js";

export const FEED_URL = "data/cards.json";
export const FEED_CACHE_KEY = "ynab-toolkit.cardCatalogue";
// Was a day, until a corrected value (Aeroplan at 1.1c) took up to a day
// to reach a phone that had already downloaded the old file (reported
// live). An unchanged file costs a "not modified" reply, so checking every
// time the page opens is cheap; the window only spares tab-to-tab hops.
export const FEED_MAX_AGE_MS = 5 * 60 * 1000;

function readCache(storage) {
  try {
    const cached = JSON.parse(storage?.getItem(FEED_CACHE_KEY) || "null");
    if (cached && validateCatalogue(cached.data).length === 0) return cached;
  } catch {
    // A corrupt or blocked cache is the same as no cache.
  }
  return null;
}

function writeCache(storage, entry) {
  try {
    storage?.setItem(FEED_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the download still applies for this visit.
  }
}

/**
 * Load the catalogue, downloading it only when the saved copy is more than
 * a day old (or `force` is set). Resolves to:
 *   { ok, source: "saved" | "downloaded" | "saved-fallback" | "none",
 *     fetchedAt, checked, error }
 * `source` "saved-fallback" means a download was due but failed, so the
 * saved copy is in use; "none" means there is nothing to show at all.
 */
export async function loadCatalogue({ fetchJson, storage, now = Date.now(), force = false } = {}) {
  const cached = readCache(storage);
  if (cached && !force && now - cached.fetchedAt < FEED_MAX_AGE_MS) {
    setCatalogue(cached.data);
    return { ok: true, source: "saved", fetchedAt: cached.fetchedAt, checked: cached.data.checked, error: "" };
  }

  let error = "";
  try {
    const data = await fetchJson(FEED_URL);
    const problems = validateCatalogue(data);
    if (problems.length === 0) {
      writeCache(storage, { fetchedAt: now, data });
      setCatalogue(data);
      return { ok: true, source: "downloaded", fetchedAt: now, checked: data.checked, error: "" };
    }
    error = `The downloaded card details were not usable: ${problems[0]}`;
  } catch (failure) {
    error = `Could not download card details (${failure?.message || failure}).`;
  }

  if (cached) {
    setCatalogue(cached.data);
    return { ok: true, source: "saved-fallback", fetchedAt: cached.fetchedAt, checked: cached.data.checked, error };
  }
  return { ok: false, source: "none", fetchedAt: 0, checked: "", error };
}

/** The browser's way of getting the file, bypassing the HTTP cache. */
export async function browserFetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
