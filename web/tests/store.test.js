// Settings storage: the part that answers "what happens if I clear history?"

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A stand-in for the browser's localStorage, so the store can be exercised
// outside a page.
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new FakeStorage();

const { Store, DEFAULTS, SCHEMA_VERSION } = await import("../js/store.js");

describe("store", () => {
  beforeEach(() => globalThis.localStorage.clear());

  test("a first visit gets the defaults, not somebody else's settings", () => {
    const store = new Store().load();
    assert.equal(store.get("budgetId"), "");
    assert.equal(store.get("people.person1.name"), "");
    assert.deepEqual(store.get("sharedExpenses.rules"), []);
  });

  test("settings survive a reload", () => {
    const first = new Store().load();
    first.set("budgetName", "Household");
    first.set("people.person1.name", "Alex");
    first.save();

    const second = new Store().load();
    assert.equal(second.get("budgetName"), "Household");
    assert.equal(second.get("people.person1.name"), "Alex");
  });

  test("clearing browser storage takes the settings with it", () => {
    const store = new Store().load();
    store.set("budgetName", "Household");
    globalThis.localStorage.clear();

    const after = new Store().load();
    assert.equal(after.get("budgetName"), "",
      "this is exactly why the export file exists");
  });

  test("an export restores everything on a clean browser", () => {
    const original = new Store().load();
    original.set("budgetName", "Household");
    original.set("sharedExpenses.rules", [
      { sharedCategoryId: "a", person1CategoryId: "b", person2CategoryId: "c",
        name: "Groceries" },
    ]);
    const backup = JSON.parse(JSON.stringify(original.exportData()));

    globalThis.localStorage.clear();
    const fresh = new Store().load();
    assert.equal(fresh.get("budgetName"), "");

    const result = fresh.importData(backup);
    assert.equal(result.ok, true);
    assert.equal(fresh.get("budgetName"), "Household");
    assert.equal(fresh.get("sharedExpenses.rules").length, 1);
  });

  test("an export never contains the token", () => {
    const store = new Store().load();
    store.set("rememberToken", true);
    store.saveToken("not-a-real-token");
    assert.equal(JSON.stringify(store.exportData()).includes("not-a-real-token"),
      false);
  });

  test("the token is only read back when remembering was asked for", () => {
    const store = new Store().load();
    store.saveToken("not-a-real-token");
    assert.equal(new Store().load().loadToken(), "");

    store.set("rememberToken", true);
    assert.equal(new Store().load().loadToken(), "not-a-real-token");
  });

  test("a backup from a newer version is refused rather than half applied", () => {
    const store = new Store().load();
    store.set("budgetName", "Household");
    const result = store.importData({
      app: "YNAB Toolkit", schema: SCHEMA_VERSION + 1, settings: { budgetName: "Other" },
    });
    assert.equal(result.ok, false);
    assert.equal(store.get("budgetName"), "Household");
  });

  test("a file that is not a backup is refused", () => {
    const store = new Store().load();
    assert.equal(store.importData({ hello: "world" }).ok, false);
    assert.equal(store.importData(null).ok, false);
  });

  test("an old backup gains any settings added since", () => {
    const store = new Store().load();
    const result = store.importData({
      schema: 1, settings: { budgetName: "Household" },
    });
    assert.equal(result.ok, true);
    // Missing sections come from the defaults rather than being undefined.
    assert.equal(store.get("duplicates.withinDays"), DEFAULTS.duplicates.withinDays);
    assert.deepEqual(store.get("tools.enabled"), DEFAULTS.tools.enabled);
  });

  test("reset wipes the settings and the token together", () => {
    const store = new Store().load();
    store.set("rememberToken", true);
    store.saveToken("not-a-real-token");
    store.set("budgetName", "Household");

    store.reset();
    assert.equal(store.get("budgetName"), "");
    assert.equal(store.loadToken(), "");
  });

  test("corrupt storage does not stop the app opening", () => {
    globalThis.localStorage.setItem("ynab-toolkit.settings", "{not json");
    const store = new Store().load();
    assert.equal(store.get("people.person1.name"), "");
  });
});
