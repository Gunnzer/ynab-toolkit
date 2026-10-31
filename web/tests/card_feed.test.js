import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CARDS, setCatalogue } from "../js/tools/card_catalogue.js";
import { FEED_CACHE_KEY, FEED_MAX_AGE_MS, loadCatalogue } from "../js/tools/card_feed.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 10, 1, 12);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

function counting(result) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (result instanceof Error) throw result;
    return structuredClone(result);
  };
  return { calls, fetchJson };
}

const saved = (fetchedAt, data = SHIPPED) =>
  ({ [FEED_CACHE_KEY]: JSON.stringify({ fetchedAt, data }) });

describe("daily card details download", () => {
  beforeEach(() => setCatalogue(null));

  test("first visit downloads, validates and saves", async () => {
    const storage = memoryStorage();
    const { calls, fetchJson } = counting(SHIPPED);
    const result = await loadCatalogue({ fetchJson, storage, now: NOW });
    assert.deepEqual(calls, ["data/cards.json"]);
    assert.equal(result.source, "downloaded");
    assert.equal(CARDS.length, SHIPPED.cards.length);
    assert.equal(JSON.parse(storage.data[FEED_CACHE_KEY]).fetchedAt, NOW);
  });

  test("a copy under a day old is used without downloading", async () => {
    const { calls, fetchJson } = counting(SHIPPED);
    const result = await loadCatalogue({
      fetchJson, storage: memoryStorage(saved(NOW - FEED_MAX_AGE_MS + 60000)), now: NOW,
    });
    assert.equal(calls.length, 0);
    assert.equal(result.source, "saved");
    assert.ok(CARDS.length > 0);
  });

  test("a day-old copy is replaced, and Check for updates always downloads", async () => {
    const newer = { ...structuredClone(SHIPPED), checked: "2026-11-20" };
    newer.cards[0].checked = "2026-11-20";
    const stale = await loadCatalogue({
      ...counting(newer), storage: memoryStorage(saved(NOW - FEED_MAX_AGE_MS)), now: NOW,
    });
    assert.equal(stale.source, "downloaded");
    assert.equal(stale.checked, "2026-11-20");

    const { calls, fetchJson } = counting(SHIPPED);
    await loadCatalogue({ fetchJson, storage: memoryStorage(saved(NOW)), now: NOW, force: true });
    assert.equal(calls.length, 1);
  });

  test("offline: keeps using the saved copy and says why", async () => {
    const result = await loadCatalogue({
      ...counting(new Error("offline")), storage: memoryStorage(saved(NOW - 3 * FEED_MAX_AGE_MS)), now: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "saved-fallback");
    assert.match(result.error, /offline/);
    assert.ok(CARDS.length > 0);
  });

  test("a broken download is never used", async () => {
    const broken = structuredClone(SHIPPED);
    broken.cards[0].network = "diners";
    const storage = memoryStorage(saved(NOW - 2 * FEED_MAX_AGE_MS));
    const result = await loadCatalogue({ ...counting(broken), storage, now: NOW });
    assert.equal(result.source, "saved-fallback");
    assert.match(result.error, /not usable/);
    assert.equal(CARDS.find((c) => c.id === broken.cards[0].id).network, SHIPPED.cards[0].network);
    assert.equal(JSON.parse(storage.data[FEED_CACHE_KEY]).fetchedAt, NOW - 2 * FEED_MAX_AGE_MS,
      "the good copy is not overwritten");
  });

  test("nothing saved and no download: nothing to show, with a reason", async () => {
    const result = await loadCatalogue({ ...counting(new Error("HTTP 404")), storage: memoryStorage(), now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.source, "none");
    assert.match(result.error, /HTTP 404/);
    assert.equal(CARDS.length, 0);
  });

  test("a corrupt saved copy or blocked storage counts as no copy", async () => {
    const corrupt = memoryStorage({ [FEED_CACHE_KEY]: "{not json" });
    const result = await loadCatalogue({ ...counting(SHIPPED), storage: corrupt, now: NOW });
    assert.equal(result.source, "downloaded");
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    const again = await loadCatalogue({ ...counting(SHIPPED), storage: blocked, now: NOW });
    assert.equal(again.source, "downloaded");
  });
});
