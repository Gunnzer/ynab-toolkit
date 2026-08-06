// Shared application state: the store, the token, and the fetched budget.

import { YnabClient, flattenCategories } from "./api.js";
import { Store } from "./store.js";

// sessionStorage, not localStorage: this is fetched YNAB data, not a
// setting, and it should not survive past this tab closing. Its only job
// is making a plain page reload (F5) free, not becoming another place your
// budget sits around forever.
const SESSION_KEY = "ynab-toolkit.session";

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
    // Fetched once, shared by every page. See transactions() and month().
    this.txCache = null;
    this.monthCache = new Map();
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

  // ---------- fetched data, shared between pages ----------
  //
  // Every tool wants the same transactions, and YNAB allows 200 requests an
  // hour. Fetching once and handing the same list to each page keeps that
  // budget for the writes that actually need it, and makes switching pages
  // instant instead of a round trip.

  /**
   * Transactions since a date, from cache when the cache already covers it.
   *
   * A cache fetched from an earlier date covers any later one, so widening
   * the range refetches but narrowing it does not.
   */
  async transactions(since, { force = false } = {}) {
    const cache = this.txCache;
    const usable = !force && cache &&
      cache.budgetId === this.budgetId && cache.since <= since;

    if (usable) {
      return {
        list: cache.list.filter((item) => item.date >= since),
        fetchedAt: cache.at,
        cached: true,
      };
    }

    const list = await this.requireClient().transactions(this.budgetId, since);
    this.txCache = { budgetId: this.budgetId, since, at: Date.now(), list };
    this.notify();
    return { list, fetchedAt: this.txCache.at, cached: false };
  }

  /**
   * The whole transaction history, fetched once. An empty since sorts
   * before any real date, so this satisfies every narrower request after
   * it: every tool that asks for "since some date" gets served from this
   * without another call to YNAB.
   */
  async loadAllTransactions({ force = false } = {}) {
    return this.transactions("", { force });
  }

  /**
   * Record transactions already in hand, e.g. fetched alongside categories
   * and accounts in one connect. Used instead of loadAllTransactions()
   * when the caller already has the list, so nothing is fetched twice.
   */
  cacheTransactions(list) {
    this.txCache = { budgetId: this.budgetId, since: "", at: Date.now(), list };
    this.notify();
  }

  /**
   * Refetch categories, accounts and the full transaction history for the
   * current budget, in parallel. This is the one place "start over" means
   * for the whole app: every page reads from this same cache, so nothing
   * else needs to call YNAB again until this runs.
   */
  async reloadAll() {
    const client = this.requireClient();
    const [groups, accounts, transactions] = await Promise.all([
      client.categories(this.budgetId),
      client.accounts(this.budgetId),
      client.transactions(this.budgetId),
    ]);
    this.categoryGroups = groups;
    this.accounts = accounts;
    this.cacheTransactions(transactions);
    this.persistSession();
    this.notify();
    return { groups, accounts, transactions };
  }

  // ---------- surviving a page reload ----------
  //
  // A plain browser refresh throws away everything above: it is a new page
  // load, so a new AppState, so an empty cache. Without this, pressing F5
  // would silently repeat the connect-time fetch every time, which is
  // exactly the incidental API use the shared cache was built to avoid.
  // Only the token and settings (in localStorage) are meant to survive
  // that; this mirrors them into sessionStorage, tab-scoped and gone when
  // the tab closes, so refreshing is free but nothing lingers indefinitely.

  persistSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        budgetId: this.budgetId,
        budgets: this.budgets,
        categoryGroups: this.categoryGroups,
        accounts: this.accounts,
        txCache: this.txCache,
      }));
    } catch {
      // Private browsing or a full quota. Refreshing just costs a fetch.
    }
  }

  /** True if this tab already had everything for the current budget. */
  restoreSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || saved.budgetId !== this.budgetId) return false;
      if (!saved.txCache || !Array.isArray(saved.budgets)) return false;

      this.budgets = saved.budgets;
      this.categoryGroups = saved.categoryGroups || [];
      this.accounts = saved.accounts || [];
      this.txCache = saved.txCache;
      return true;
    } catch {
      return false;
    }
  }

  clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to do */
    }
  }

  /** One budget month, cached per budget. */
  async month(month, { force = false } = {}) {
    const key = `${this.budgetId}|${month}`;
    const cached = this.monthCache.get(key);
    if (!force && cached) {
      return { data: cached.data, fetchedAt: cached.at, cached: true };
    }

    const data = await this.requireClient().month(this.budgetId, month);
    this.monthCache.set(key, { data, at: Date.now() });
    return { data, fetchedAt: Date.now(), cached: false };
  }

  /**
   * Throw away fetched data.
   *
   * Called after anything that writes to YNAB, because the copy in hand no
   * longer matches the budget, and a tool acting on stale figures would be
   * worse than one that simply refetches.
   */
  invalidate() {
    this.txCache = null;
    this.monthCache.clear();
    this.notify();
  }

  /** How old the transaction cache is, in words, or null when empty. */
  dataAge() {
    if (!this.txCache || this.txCache.budgetId !== this.budgetId) return null;
    const seconds = (Date.now() - this.txCache.at) / 1000;
    if (seconds < 90) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
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

  /**
   * The selected budget's own summary, straight from YNAB's /budgets list.
   * Carries first_month/last_month, which is what "as far back as your
   * budget goes" actually means, rather than a guess.
   */
  get currentBudget() {
    return (this.budgets || []).find((b) => b.id === this.budgetId) || null;
  }

  /** "YYYY-MM" for the earliest month this budget has data for, if known. */
  get firstBudgetMonth() {
    const value = this.currentBudget?.first_month;
    return typeof value === "string" && value.length >= 7 ? value.slice(0, 7) : null;
  }

  setBudget(id, name) {
    if (id !== this.budgetId) {
      // Category ids are budget-scoped; a stale cache would mislead.
      this.categoryGroups = [];
      this.accounts = [];
      this.txCache = null;
      this.monthCache.clear();
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
      .map((group) => ({ id: group.id, name: group.name, hidden: Boolean(group.hidden) }));
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
