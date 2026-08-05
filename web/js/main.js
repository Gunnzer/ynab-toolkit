// App shell: sidebar, routing, and the bits of chrome every page shares.

import { AppState } from "./state.js";
import { requestPersistence } from "./store.js";
import { alertDialog, clear, el, icon, setPill } from "./ui.js";

import { homePage } from "./pages/home.js";
import { setupPage } from "./pages/setup.js";
import { budgetPage } from "./pages/budget.js";
import { reportsPage } from "./pages/reports.js";
import { splitSheetPage } from "./pages/splitsheet.js";
import { sharedExpensesPage } from "./pages/shared.js";
import { autoAssignPage } from "./pages/autoassign.js";
import { duplicatesPage } from "./pages/duplicates.js";
import { bankImportPage } from "./pages/bank.js";

// Home first, then the daily tools. Setup is pinned to the sidebar footer.
// `key` is the flag under tools.enabled; pages without one are always shown.
export const PAGES = [
  {
    id: "home", title: "Home", icon: "home", build: homePage,
  },
  {
    id: "budget", title: "Budget", icon: "chart", key: "budgetOverview",
    build: budgetPage,
    blurb: "See where a month stands: what is left to assign, what is " +
      "overspent, and what every category holds.",
  },
  {
    id: "reports", title: "Reports", icon: "trend", key: "reports",
    build: reportsPage,
    blurb: "Monthly spending from your history, filtered to one person and " +
      "saved so the same report is one click.",
  },
  {
    id: "shared", title: "Shared Expenses", icon: "split", key: "sharedExpenses",
    build: sharedExpensesPage,
    blurb: "Split transactions in your shared categories between two people, " +
      "as native YNAB splits.",
  },
  {
    id: "splitsheet", title: "Bill Splitting", icon: "sheet", key: "splitSheet",
    build: splitSheetPage,
    blurb: "Work out whose expense each transaction was and export one row " +
      "per expense for a shared expense tracker.",
  },
  {
    id: "autoassign", title: "Auto Assign", icon: "fill", key: "autoAssign",
    build: autoAssignPage,
    blurb: "Empty a holding category into your targeted categories, in the " +
      "priority order you set.",
  },
  {
    id: "duplicates", title: "Duplicates", icon: "copies", key: "duplicates",
    build: duplicatesPage,
    blurb: "Find transactions imported twice and flag them for review. " +
      "Never deletes anything.",
  },
  {
    id: "bank", title: "Bank Import", icon: "upload", key: "bankImport",
    build: bankImportPage,
    blurb: "Turn a bank export into a CSV that YNAB can import, tidying " +
      "payee names on the way.",
  },
];

export const SETUP_PAGE = {
  id: "setup", title: "Setup", icon: "settings", build: setupPage,
};

export const TOGGLEABLE = PAGES.filter((page) => page.key);

class App {
  constructor() {
    this.state = new AppState();
    this.current = null;
    this.busyCount = 0;

    this.nav = document.getElementById("nav");
    this.navSetup = document.getElementById("nav-setup");
    this.pageHost = document.getElementById("page");
    this.title = document.getElementById("page-title");
    this.pill = document.getElementById("status-pill");
    this.rate = document.getElementById("rate-limit");
    this.status = document.getElementById("status-text");
    this.busy = document.getElementById("busy");

    this.dataAge = document.getElementById("data-age");
    this.refreshButton = document.getElementById("refresh-button");

    document.getElementById("help-button")
      .addEventListener("click", () => this.showHelp());

    // Transactions are fetched once and shared between pages, so there has
    // to be one obvious way to say "I changed something in YNAB, read it
    // again".
    this.refreshButton.addEventListener("click", () => {
      this.state.invalidate();
      this.setStatus("Loaded data cleared. Run the tool again to re-read.");
    });

    this.state.subscribe(() => this.refreshChrome());
    this.state.store.subscribe(() => this.buildNav());

    window.addEventListener("hashchange", () => this.routeFromHash());
  }

  // ---------- tools ----------

  toolEnabled(key) {
    const enabled = this.state.store.get("tools.enabled", {}) || {};
    return enabled[key] !== false;
  }

  enabledToolPages() {
    return TOGGLEABLE.filter((page) => this.toolEnabled(page.key));
  }

  visiblePages() {
    return PAGES.filter((page) => !page.key || this.toolEnabled(page.key));
  }

  // ---------- navigation ----------

  buildNav() {
    const render = (host, pages) => {
      clear(host);
      for (const page of pages) {
        host.append(el("button", {
          type: "button",
          class: "nav-item",
          "data-page": page.id,
          "aria-current": this.current === page.id ? "page" : null,
          onClick: () => this.go(page.id),
        }, icon(page.icon), el("span", { text: page.title })));
      }
    };
    render(this.nav, this.visiblePages());
    render(this.navSetup, [SETUP_PAGE]);
  }

  routeFromHash() {
    const id = (location.hash || "").replace(/^#\/?/, "") || null;
    const known = [...PAGES, SETUP_PAGE].some((page) => page.id === id);
    this.show(known ? id : this.defaultPage());
  }

  defaultPage() {
    // Home when there is something to come home to, Setup otherwise.
    return this.state.token && this.state.budgetId ? "home" : "setup";
  }

  go(id) {
    if (location.hash === `#/${id}`) this.show(id);
    else location.hash = `#/${id}`;
  }

  show(id) {
    const page = [...PAGES, SETUP_PAGE].find((entry) => entry.id === id);
    if (!page) return this.show(this.defaultPage());

    // A tool switched off while open falls back to Home.
    if (page.key && !this.toolEnabled(page.key)) return this.go("home");

    this.current = id;
    this.title.textContent = page.title;
    document.title = `${page.title} - YNAB Toolkit`;

    clear(this.pageHost).append(page.build(this));
    this.pageHost.focus({ preventScroll: true });
    this.buildNav();
    this.refreshChrome();
  }

  /** Re-render the page currently on screen. */
  refresh() {
    if (this.current) this.show(this.current);
  }

  // ---------- chrome ----------

  refreshChrome() {
    const state = this.state;
    let text = "";
    let kind = "muted";

    if (!state.token) {
      text = "Not connected";
    } else if (state.connection === "connecting") {
      [text, kind] = ["Connecting...", "info"];
    } else if (state.connection === "failed") {
      [text, kind] = ["Connection failed", "error"];
    } else if (!state.budgetName) {
      [text, kind] = ["No budget selected", "warn"];
    } else if (!state.hasBudgetData) {
      [text, kind] = [`${state.budgetName}: categories not loaded`, "warn"];
    } else {
      [text, kind] = [state.budgetName, "ok"];
    }

    setPill(this.pill, text, kind);
    this.rate.textContent = state.rateLimit
      ? `API calls used: ${state.rateLimit}` : "";

    const age = state.dataAge();
    this.dataAge.textContent = age ? `Transactions loaded ${age}` : "";
    this.refreshButton.hidden = !age;
  }

  setBusy(busy) {
    this.busyCount = Math.max(0, this.busyCount + (busy ? 1 : -1));
    const running = this.busyCount > 0;
    this.busy.hidden = !running;
    this.status.textContent = running ? "Working..." : "Ready.";
    if (!running) this.refreshChrome();
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  /**
   * Run an async job with busy state and error reporting.
   * Buttons passed in are disabled for the duration.
   */
  async run(job, { log, buttons = [] } = {}) {
    const stopped = { value: false };
    for (const node of buttons) node.disabled = true;
    this.setBusy(true);
    try {
      return await job({ shouldStop: () => stopped.value });
    } catch (error) {
      if (log?.write) log.write(`ERROR: ${error.message}`, "error");
      else await alertDialog("Something went wrong", error.message);
      return null;
    } finally {
      for (const node of buttons) node.disabled = false;
      this.setBusy(false);
      this.refreshChrome();
    }
  }

  /**
   * Reconnect on load, when a remembered token makes that possible.
   *
   * Costs three requests out of the 200 an hour YNAB allows, which is a fair
   * trade for not making someone press Connect before every session. Budgets,
   * categories and accounts are fetched in one run: chaining them through
   * separate calls is how the desktop version once got stuck showing
   * "categories not loaded" forever.
   */
  async autoConnect() {
    const state = this.state;
    if (!state.token || state.connection !== "idle") return;

    state.connection = "connecting";
    state.notify();
    this.setStatus("Reconnecting to YNAB...");

    try {
      const client = state.client();
      const budgets = await client.budgets();
      let index = budgets.findIndex((budget) => budget.id === state.budgetId);
      if (index < 0 && budgets.length) index = 0;

      if (index >= 0) {
        state.setBudget(budgets[index].id, budgets[index].name);
        state.categoryGroups = await client.categories(budgets[index].id);
        state.accounts = await client.accounts(budgets[index].id);
      }
      state.budgets = budgets;
      state.connection = "connected";
    } catch {
      // Silent: the status pill says "Connection failed", and Setup explains
      // it properly if they go looking.
      state.connection = "failed";
    }

    state.notify();
    this.setStatus("Ready.");

    // Rebuilding the page would throw away anything typed while we waited.
    const active = document.activeElement;
    const typing = active && this.pageHost.contains(active) &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (!typing) this.refresh();
  }

  showHelp() {
    alertDialog("YNAB Toolkit",
      "Everything runs in your browser. There is no server: your token and " +
      "settings never leave this device, and the only requests made are to " +
      "api.ynab.com with your own token.\n\n" +
      "Getting started\n" +
      "Open Setup and paste a YNAB personal access token. Create one at " +
      "ynab.com under Account Settings > Developer Settings > New Token. " +
      "Then pick your budget.\n\n" +
      "Keeping your settings\n" +
      "Settings live in this browser's storage, which clearing browsing " +
      "data will erase. Use Back up settings on the Setup page to save them " +
      "to a file you can restore here or on another machine.\n\n" +
      "YNAB allows 200 API requests per hour per token.");
  }
}

const app = new App();
app.buildNav();
app.routeFromHash();
// Ask the browser not to evict our storage on its own. This does not stop
// someone clearing site data by hand, which is what the backup file is for.
requestPersistence();
app.autoConnect();

// A file dropped anywhere but a drop zone would otherwise be opened by the
// browser, navigating away from the app and losing whatever was on screen.
for (const name of ["dragover", "drop"]) {
  window.addEventListener(name, (event) => {
    if (event.target.closest?.(".dropzone")) return;
    event.preventDefault();
    if (name === "dragover") event.dataTransfer.dropEffect = "none";
  });
}

// Handy in the console while testing; harmless in production.
window.ynabToolkit = app;
