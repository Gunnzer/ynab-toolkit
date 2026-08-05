// Shared application state: the store, the token, and the fetched budget.

import { YnabClient, flattenCategories } from "./api.js";
import { Store } from "./store.js";

export class AppState {
  constructor() {
    this.store = new Store().load();
    this.token = this.store.loadToken();
    this.budgets = [];
    this.categoryGroups = [];
    this.accounts = [];
    this.rateLimit = "";
    // idle | connecting | connected | failed
    this.connection = "idle";
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event = "change") {
    for (const listener of [...this.listeners]) {
      try {
        listener(event, this);
      } catch (error) {
        console.error(error);
      }
    }
  }

  client() {
    return new YnabClient(this.token, (limit) => {
      this.rateLimit = limit;
    });
  }

  requireClient() {
    if (!this.token) {
      throw new Error(
        "No access token yet. Open Setup, paste your YNAB personal access " +
        "token and press Connect.");
    }
    return this.client();
  }

  get budgetId() {
    return this.store.get("budgetId", "");
  }

  get budgetName() {
    return this.store.get("budgetName", "");
  }

  setBudget(id, name) {
    if (id !== this.budgetId) {
      // Category ids are budget-scoped; a stale cache would mislead.
      this.categoryGroups = [];
      this.accounts = [];
    }
    this.store.set("budgetId", id);
    this.store.set("budgetName", name);
  }

  get hasBudgetData() {
    return this.categoryGroups.length > 0;
  }

  flatCategories(includeHidden = null) {
    const hidden = includeHidden === null
      ? Boolean(this.store.get("explorer.includeHidden"))
      : includeHidden;
    return flattenCategories(this.categoryGroups, hidden);
  }

  groups(includeHidden = false) {
    return (this.categoryGroups || [])
      .filter((group) =>
        !group.deleted &&
        (includeHidden || !group.hidden) &&
        group.name !== "Internal Master Category")
      .map((group) => ({ id: group.id, name: group.name }));
  }

  categoryName(id, fallback = "(unknown category)") {
    if (!id) return "";
    const match = this.flatCategories(true).find((i) => i.category.id === id);
    return match ? match.category.name : fallback;
  }

  groupName(id, fallback = "(unknown group)") {
    const match = this.groups(true).find((group) => group.id === id);
    return match ? match.name : fallback;
  }

  accountName(id) {
    const match = (this.accounts || []).find((account) => account.id === id);
    return match ? match.name : "";
  }

  // ---------- the two people ----------

  /** One person, with blanks filled in so callers never handle undefined. */
  person(which) {
    const saved = this.store.get(`people.person${which}`, {}) || {};
    return {
      name: (saved.name || "").trim(),
      groupPrefix: (saved.groupPrefix || "").trim(),
      accountTag: (saved.accountTag || "").trim(),
    };
  }

  /** What to call them on screen before they have been named. */
  personName(which) {
    return this.person(which).name || `Person ${which}`;
  }

  /** True once both people have been named in Setup. */
  get peopleNamed() {
    return Boolean(this.person(1).name && this.person(2).name);
  }

  /**
   * Tool settings with the shared people folded in, which is the shape the
   * tool modules expect. Keeps "who they are" in one place without every
   * tool module needing to know where that place is.
   */
  withPeople(settings) {
    const [first, second] = [this.person(1), this.person(2)];
    return {
      ...settings,
      person1Name: this.personName(1),
      person2Name: this.personName(2),
      person1GroupPrefix: first.groupPrefix,
      person2GroupPrefix: second.groupPrefix,
      person1AccountTag: first.accountTag,
      person2AccountTag: second.accountTag,
    };
  }

  /** Timestamp a successful run so Home can show when it last ran. */
  recordRun(key) {
    const runs = { ...(this.store.get("tools.lastRun", {}) || {}) };
    runs[key] = new Date().toISOString();
    this.store.set("tools.lastRun", runs);
  }
}
