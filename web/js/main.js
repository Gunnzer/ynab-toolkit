// App shell: sidebar, routing, and the bits of chrome every page shares.

import { AppState } from "./state.js";
import { requestPersistence } from "./store.js";
import { alertDialog, clear, el, getPageIntro, icon, setPill } from "./ui.js";

import { homePage } from "./pages/home.js";
import { setupPage } from "./pages/setup.js";
import { budgetPage } from "./pages/budget.js";
import { classicBudgetPage } from "./pages/classicbudget.js";
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
    id: "budget", title: "YNAB Budget", icon: "chart", key: "budgetOverview",
    build: budgetPage,
    blurb: "See where a month stands: what is left to assign, what is " +
      "overspent, and what every category holds.",
    // Pops out as one "Budget" item in the sidebar with both choices under
    // it, rather than two separate nav entries.
    group: "budget", groupLabel: "Budget", groupIcon: "chart",
  },
  {
    id: "classic-budget", title: "Classic Budget", icon: "chart",
    key: "classicBudgetOverview", build: classicBudgetPage,
    blurb: "Your categories with a plan of your own next to them: set what " +
      "you meant to spend, and see whether a category ran over it.",
    group: "budget", groupLabel: "Budget", groupIcon: "chart",
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
    this.sidebar = document.querySelector(".sidebar");
    this.sidebarToggle = document.getElementById("sidebar-toggle");
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

    this.sidebarToggle.append(icon("collapse"));
    this.applySidebarCollapsed(this.state.store.get("sidebarCollapsed", false));
    this.sidebarToggle.addEventListener("click", () => {
      const collapsed = !this.sidebar.classList.contains("is-collapsed");
      this.state.store.set("sidebarCollapsed", collapsed);
      this.applySidebarCollapsed(collapsed);
    });

    // Everything is fetched once at connect and shared between pages, so
    // there has to be one obvious way to say "I changed something in YNAB,
    // read it again" that does not mean visiting every tool in turn.
    this.refreshButton.addEventListener("click", async () => {
      const result = await this.run(async () => this.state.reloadAll(),
        { buttons: [this.refreshButton] });
      if (!result) return;
      this.setStatus("Re-read from YNAB.");
      this.refresh();
    });

    this.state.subscribe(() => this.refreshChrome());
    this.state.store.subscribe(() => this.buildNav());

    window.addEventListener("hashchange", () => this.routeFromHash());

    // refreshChrome() only otherwise runs when something changes. Without
    // this, "just now" would sit there unchanged for as long as the tab
    // stays open and nothing else happens to trigger a repaint.
    setInterval(() => this.refreshChrome(), 30000);
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

  applySidebarCollapsed(collapsed) {
    this.sidebar.classList.toggle("is-collapsed", collapsed);
    this.sidebarToggle.setAttribute("aria-label",
      collapsed ? "Expand sidebar" : "Collapse sidebar");
    this.sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  buildNav() {
    const render = (host, pages) => {
      clear(host);
      const doneGroups = new Set();
      for (const page of pages) {
        if (page.group) {
          if (doneGroups.has(page.group)) continue;
          doneGroups.add(page.group);
          host.append(this.buildNavGroup(page,
            pages.filter((p) => p.group === page.group)));
          continue;
        }
        host.append(el("button", {
          type: "button",
          class: "nav-item",
          "data-page": page.id,
          title: page.title,
          "aria-current": this.current === page.id ? "page" : null,
          onClick: () => this.go(page.id),
        }, icon(page.icon), el("span", { text: page.title })));
      }
    };
    render(this.nav, this.visiblePages());
    render(this.navSetup, [SETUP_PAGE]);
  }

  /** One sidebar entry that pops out a small menu of its member pages. */
  buildNavGroup(representative, members) {
    const isActive = members.some((page) => page.id === this.current);
    const parent = el("button", {
      type: "button",
      class: "nav-item nav-item-parent",
      title: representative.groupLabel || representative.title,
      "aria-current": isActive ? "page" : null,
      "aria-haspopup": "true",
      "aria-expanded": "false",
    }, icon(representative.groupIcon || representative.icon),
      el("span", { text: representative.groupLabel || representative.title }),
      el("span", { class: "nav-caret", "aria-hidden": "true", text: "›" }));

    const flyout = el("div", { class: "nav-flyout", role: "menu" });
    for (const page of members) {
      flyout.append(el("button", {
        type: "button",
        class: "nav-flyout-item",
        role: "menuitem",
        "aria-current": this.current === page.id ? "page" : null,
        onClick: () => { this.go(page.id); close(); },
      }, el("span", { text: page.title })));
    }

    const wrap = el("div", { class: "nav-item-wrap" }, parent, flyout);
    const close = () => {
      wrap.classList.remove("is-open");
      parent.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      wrap.classList.add("is-open");
      parent.setAttribute("aria-expanded", "true");
    };

    // Hover is the primary way in; click and Escape cover keyboard and
    // touch, where there is no hover to open or close it with.
    wrap.addEventListener("mouseleave", close);
    parent.addEventListener("click", () => {
      wrap.classList.contains("is-open") ? close() : open();
    });
    parent.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });

    return wrap;
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

    // A plain page reload lands here too. If this tab already fetched
    // everything for this budget, that is still good: reuse it rather
    // than asking YNAB again just because the page happened to reload.
    if (state.restoreSession()) {
      state.connection = "connected";
      state.notify();
      this.refresh();
      return;
    }

    state.connection = "connecting";
    state.notify();
    this.setStatus("Reconnecting to YNAB...");

    try {
      const client = state.client();
      const budgets = await client.budgets();
      let index = budgets.findIndex((budget) => budget.id === state.budgetId);
      if (index < 0 && budgets.length) index = 0;

      state.budgets = budgets;
      if (index >= 0) {
        state.setBudget(budgets[index].id, budgets[index].name);
        const [groups, accounts, transactions] = await Promise.all([
          client.categories(budgets[index].id),
          client.accounts(budgets[index].id),
          // The full history, fetched once here so no other page ever
          // has to ask YNAB for it again this session.
          client.transactions(budgets[index].id),
        ]);
        state.categoryGroups = groups;
        state.accounts = accounts;
        state.cacheTransactions(transactions);
      }
      state.connection = "connected";
      state.persistSession();
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
    const intro = getPageIntro();
    // The page-specific description used to sit visibly at the top of every
    // page; it now only shows up here, for whichever page is open.
    const pageSection = intro ? `${this.title.textContent}\n${intro}\n\n` : "";

    alertDialog("YNAB Toolkit",
      pageSection +
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
