// Settings storage.
//
// Everything lives in this browser's localStorage under one key. Nothing is
// sent anywhere: there is no server behind this app, and the only network
// calls it ever makes are to api.ynab.com with your own token.
//
// Browser storage can be wiped by "clear browsing data", so every setting
// can be exported to a JSON file and imported again on any browser or
// machine. That file is the durable copy; treat it the way you would treat
// any other backup.
//
// The token is deliberately kept under a separate key from the settings, so
// exporting settings never exports the token.

const SETTINGS_KEY = "ynab-toolkit.settings";
const TOKEN_KEY = "ynab-toolkit.token";

export const SCHEMA_VERSION = 1;

// Defaults ship with no personal data: no token, no budget, no names, no
// payees. A fresh visitor sees an empty app.
export const DEFAULTS = {
  schema: SCHEMA_VERSION,
  budgetId: "",
  budgetName: "",
  rememberToken: false,
  explorer: { includeHidden: false },
  // Which category groups are rolled up on the Budget page, by group id.
  budgetOverview: { collapsedGroups: [] },
  classicBudget: {
    collapsedGroups: [],
    hideUnbudgeted: false,
    month: "",              // last month picked: "YYYY-MM"
    // categoryId -> planned amount in milliunits. Applies to every month
    // right now, not just the one you set it from - there is no history
    // yet. Kept as a flat map (not nested under a month) on purpose, so
    // adding dated entries per category later does not need a migration,
    // just a richer value where this one is now a plain number.
    plannedByBudget: {},
  },
  // The two people, defined once. Shared Expenses and Bill Splitting both mean
  // the same two humans, so holding a copy each would let them disagree.
  //
  // groupPrefix: a category group starting with this belongs to that person.
  //   Blank falls back to their name.
  // accountTag: the "(J)" style marker in front of an account name.
  // Both are only read by Bill Splitting, but they describe the person, not
  // the tool, so they live with the name.
  people: {
    person1: { name: "", groupPrefix: "", accountTag: "" },
    person2: { name: "", groupPrefix: "", accountTag: "" },
  },
  tools: {
    enabled: {
      budgetOverview: true,
      reports: true,
      sharedExpenses: true,
      splitSheet: true,
      // Off to start with: most people never need these, and an unused
      // tool in the sidebar is just noise. Switch either on in Setup.
      autoAssign: false,
      duplicates: false,
      bankImport: true,
    },
    lastRun: {},
  },
  sharedExpenses: {
    person1Ratio: 0.35,
    startDate: "",
    endDate: "",
    skipAlreadySplit: true,
    rules: [],
    backups: {},
  },
  autoAssign: {
    holdingCategoryId: "",
    holdingCategoryName: "",
    groupIds: [],
    groupNames: [],
    basis: "underfunded",
    month: "current",
    backups: {},
  },
  splitSheet: {
    // Who the two people are lives under `people`, not here.
    stripAccountTag: false,
    // Day of the month a statement cycle opens. 1 is calendar months; 6
    // means the 6th to the 5th of the following month.
    cycleStartDay: 1,
    // 0 means "run right up to the day before the next cycle opens".
    cycleEndDay: 0,
    setupOpen: false,
    // Accounts left out entirely, by name. Also settable per account in the
    // cycle dialog; this list covers names that only appear in a file.
    excludedAccounts: [],
    // Which account each card belongs to, by account name: "p1", "p2" or
    // "joint". Only needed for accounts whose name does not already say.
    accountOwners: {},
    codes: { person1: "P1", person2: "P2", shared: "S", custom: "C" },
    defaultSharedCode: "S",
    // One even split to start with. Add your own ratios and codes.
    ratioPresets: [{ code: "S", person1Percent: 50, label: "Even split" }],
    tolerance: 0.02,
    skipPayeeSubstrings: [],
    splitMemoPattern: "",
    includeExcelSerial: true,
    // The Python original tried "%d/%m/%Y" before "%m/%d/%Y", so an
    // ambiguous date in a YNAB export was read day first.
    dateOrder: "dayFirst",
    source: "api",
    // "YYYY-MM"; the actual since/until dates come from these plus the
    // cycle start/end day above, so picking a month always pulls one full
    // statement cycle rather than a plain calendar month.
    sinceMonth: "",
    toMonth: "",
    columns: {},
  },
  reports: {
    // since/until are the effective dates every filter actually runs on.
    // The fields below drive them; which ones apply depends on periodMode.
    since: "",
    until: "",
    periodMode: "month",    // month | range | ytd | custom
    periodMonth: "",        // month mode: "YYYY-MM"
    rangeFrom: "",          // range mode: "YYYY-MM"
    rangeTo: "",            // range mode: "YYYY-MM"
    owner: "all",
    groupNames: [],
    excludeCategoryIds: [],
    payeeContains: "",
    includeInflow: false,
    // Named filters, so a report you look at every month is one click.
    saved: [],
    // Which saved filter, if any, the controls currently match.
    activeSavedName: "",
  },
  duplicates: {
    since: "",
    withinDays: 3,
    flagColour: "red",
    sameAccount: false,
    ignoreTransfers: true,
  },
  bankImport: {
    dateColumn: "",
    payeeColumn: "",
    amountColumn: "",
    memoColumn: "",
    outflowColumn: "",
    inflowColumn: "",
    dateFormat: "yyyy-MM-dd",
    // How to read 03/05/2025, which no file ever tells you. Month first
    // matches the PowerShell original, which parsed with InvariantCulture.
    dateOrder: "monthFirst",
    invertAmount: false,
    // Named column mappings, e.g. "EQ" -> { dateColumn: "Date", ... }, so
    // switching banks does not mean remapping every column again.
    presets: {},
    presetName: "",
    // Which account "Push to YNAB" writes into, remembered across visits.
    accountId: "",
    // A generic starting rule for Interac e-Transfers. It contains no
    // personal information; delete it on the Bank Import page if your bank
    // words things differently.
    payeeRules: [
      {
        enabled: true,
        label: "Interac e-Transfer received",
        pattern:
          "^\\s*interac\\s*e[-\\u2010-\\u2015\\u2212]?transfer\\s+received" +
          "\\s+from\\s*:?\\s*(?<name>[A-Za-z][A-Za-z .'-]+)",
        replacement: "E-Transfer from $<name>",
        titleCase: true,
        cleanName: true,
      },
      {
        enabled: true,
        label: "Interac e-Transfer sent",
        pattern:
          "^\\s*interac\\s*e[-\\u2010-\\u2015\\u2212]?transfer\\s+sent" +
          "\\s+to\\s*:?\\s*(?<name>[A-Za-z][A-Za-z .'-]+)",
        replacement: "E-Transfer to $<name>",
        titleCase: true,
        cleanName: true,
      },
    ],
  },
};

function deepMerge(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      result[key] && typeof result[key] === "object" && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class Store {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    this.listeners = new Set();
  }

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.data = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch {
      // Corrupt storage must never stop the app from opening.
      this.data = structuredClone(DEFAULTS);
    }
    return this;
  }

  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch (error) {
      // Private browsing and full quotas both land here.
      console.warn("Could not save settings:", error);
      return false;
    }
    this.emit();
    return true;
  }

  // ---------- access ----------

  get(path, fallback = undefined) {
    let node = this.data;
    for (const part of path.split(".")) {
      if (node === null || typeof node !== "object" || !(part in node)) {
        return fallback;
      }
      node = node[part];
    }
    return node;
  }

  set(path, value) {
    const parts = path.split(".");
    let node = this.data;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
    this.save();
    return this;
  }

  section(name) {
    if (!this.data[name]) this.data[name] = structuredClone(DEFAULTS[name] || {});
    return this.data[name];
  }

  // ---------- change notifications ----------

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of [...this.listeners]) {
      try {
        listener(this);
      } catch (error) {
        console.error(error);
      }
    }
  }

  // ---------- token ----------
  //
  // Held separately, and only written when "Remember on this device" is on.
  // When it is off the token lives in memory for the session only.

  loadToken() {
    if (!this.get("rememberToken")) return "";
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  saveToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      return true;
    } catch {
      return false;
    }
  }

  clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to do */
    }
  }

  // ---------- backup ----------

  /** Settings as a downloadable object. Never includes the token. */
  exportData() {
    return {
      app: "YNAB Toolkit",
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: this.data,
    };
  }

  /**
   * Replace settings from an exported file.
   * Returns { ok, message }. Refuses anything that is not one of our files.
   */
  importData(payload) {
    if (!payload || typeof payload !== "object" || !payload.settings) {
      return { ok: false, message: "That file is not a YNAB Toolkit backup." };
    }
    if (Number(payload.schema) > SCHEMA_VERSION) {
      return {
        ok: false,
        message:
          "That backup was made by a newer version of the app. Update this " +
          "page first, then import again.",
      };
    }
    this.data = deepMerge(DEFAULTS, payload.settings);
    this.save();
    return { ok: true, message: "Settings restored." };
  }

  reset() {
    this.data = structuredClone(DEFAULTS);
    this.clearToken();
    this.save();
  }
}

/**
 * Ask the browser not to evict this site's storage on its own.
 * It does not stop a person clearing site data by hand, which is exactly
 * why the export file exists.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* not supported */
  }
  return false;
}

export function estimateStorage() {
  try {
    return navigator.storage?.estimate?.() ?? null;
  } catch {
    return null;
  }
}
