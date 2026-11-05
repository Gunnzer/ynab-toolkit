// App shell: sidebar, routing, and the bits of chrome every page shares.

import { AppState } from "./state.js";
import { requestPersistence } from "./store.js";
import { alertDialog, clear, customDialog, el, getPageIntro, icon, setPill } from "./ui.js";

import { homePage } from "./pages/home.js";
import { setupPage } from "./pages/setup.js";
import { budgetPage } from "./pages/budget.js";
import { classicBudgetPage } from "./pages/classicbudget.js";
import { reportsPage } from "./pages/reports.js";
import { spendingExportPage } from "./pages/spendingexport.js";
import { splitSheetPage } from "./pages/splitsheet.js";
import { sharedExpensesPage } from "./pages/shared.js";
import { autoAssignPage } from "./pages/autoassign.js";
import { duplicatesPage } from "./pages/duplicates.js";
import { bankImportPage } from "./pages/bank.js";
import { rtaTrackerPage } from "./pages/rtatracker.js";
import { upcomingPage } from "./pages/upcoming.js";
import { categorizePage } from "./pages/categorize.js";
import { cardRewardsPage } from "./pages/cardrewards.js";

// The app is organised into a few spaces, each holding related tools as
// tabs (at explicit user request: 14 separate menu entries were
// overwhelming, especially on a phone). Following Material's 3-5
// destinations rule and YNAB's own handful of spaces: the sidebar and the
// phone's bottom bar list spaces, and a row of tabs under the title lists
// the space's tools. Every page keeps its own #/id address, so old links
// and bookmarks still land on the right tab.
//
// `group`/`groupLabel` name a page's space; Setup's tool on/off list reads
// them too, so a page only ever changes space here.
// `key` is the flag under tools.enabled; pages without one are always shown.
export const SPACES = [
  { id: "home", title: "Home", icon: "home", tabs: [{ page: "home" }] },
  {
    id: "budget", title: "Budget", icon: "chart", tabs: [
      { page: "budget", label: "This month" },
      { page: "classic-budget", label: "My plan" },
      { page: "autoassign", label: "Auto Assign" },
      { page: "rtatracker", label: "Ready to Assign" },
    ],
  },
  {
    id: "transactions", title: "Transactions", short: "Activity", icon: "check", tabs: [
      { page: "categorize", label: "To review" },
      { page: "bank", label: "Import" },
      { page: "duplicates", label: "Duplicates" },
    ],
  },
  {
    // Reports' own five tabs are listed here directly (`tab`), so there is
    // only ever one row of tabs, never a second row inside the page.
    id: "reports", title: "Reports", icon: "trend", tabs: [
      { page: "reports", tab: "spending", label: "Spending" },
      { page: "reports", tab: "budget", label: "Budget vs actual" },
      { page: "reports", tab: "trends", label: "Trends" },
      { page: "reports", tab: "recurring", label: "Recurring" },
      { page: "reports", tab: "cashflow", label: "Cash flow" },
      { page: "upcoming", label: "Upcoming bills" },
      { page: "spendingexport", label: "Export" },
    ],
  },
  {
    id: "together", title: "Together", icon: "split", tabs: [
      { page: "shared", label: "Shared Expenses" },
      { page: "splitsheet", label: "Bill Splitting" },
    ],
  },
  // `short` is the bottom bar's label, where a phone has about 75px a slot.
  { id: "cards", title: "Card Rewards", short: "Cards", icon: "wallet", tabs: [{ page: "cardrewards" }] },
];

// Spaces shown in the phone's bottom bar before anyone picks their own;
// the rest sit under More.
export const DEFAULT_BAR = ["home", "budget", "transactions", "cards"];

export const PAGES = [
  {
    id: "home", title: "Home", icon: "home", build: homePage,
  },
  {
    id: "budget", title: "YNAB Budget", icon: "chart", key: "budgetOverview",
    build: budgetPage,
    blurb: "See where a month stands: what is left to assign, what is " +
      "overspent, and what every category holds.",
    group: "budget", groupLabel: "Budget",
  },
  {
    id: "classic-budget", title: "Classic Budget", icon: "sheet",
    key: "classicBudgetOverview", build: classicBudgetPage,
    blurb: "Your categories with a plan of your own next to them: set what " +
      "you meant to spend, and see whether a category ran over it.",
    group: "budget", groupLabel: "Budget",
  },
  {
    id: "autoassign", title: "Auto Assign", icon: "fill", key: "autoAssign",
    build: autoAssignPage,
    blurb: "Empty a holding category into your targeted categories, in the " +
      "priority order you set.",
    group: "budget", groupLabel: "Budget",
  },
  {
    id: "rtatracker", title: "RTA Tracker", icon: "pulse", key: "rtaTracker",
    build: rtaTrackerPage,
    blurb: "Rebuilds Ready to Assign month by month, finds when it went " +
      "negative, and explains each month line by line.",
    group: "budget", groupLabel: "Budget",
  },
  {
    id: "categorize", title: "Categorize", icon: "check", key: "categorize",
    build: categorizePage,
    blurb: "Transactions with no category or not approved yet, with a " +
      "category suggested from your history. Approve in bulk, with undo.",
    group: "transactions", groupLabel: "Transactions",
  },
  {
    id: "bank", title: "Bank Import", icon: "upload", key: "bankImport",
    build: bankImportPage,
    blurb: "Turn a bank export into a CSV that YNAB can import, tidying " +
      "payee names on the way.",
    group: "transactions", groupLabel: "Transactions",
  },
  {
    id: "duplicates", title: "Duplicates", icon: "copies", key: "duplicates",
    build: duplicatesPage,
    blurb: "Find transactions imported twice and flag them for review. " +
      "Never deletes anything.",
    group: "transactions", groupLabel: "Transactions",
  },
  {
    id: "reports", title: "Reports", icon: "trend", key: "reports",
    build: reportsPage,
    blurb: "Spending by category and payee, budget vs actual, 12-month " +
      "trends, recurring charges and cash flow.",
    group: "reports", groupLabel: "Reports",
  },
  {
    id: "upcoming", title: "Upcoming Bills", icon: "calendar", key: "upcoming",
    build: upcomingPage,
    blurb: "What is due in the next few weeks, and whether each account " +
      "covers it before the next money comes in.",
    group: "reports", groupLabel: "Reports",
  },
  {
    id: "spendingexport", title: "Spending Export", icon: "download",
    key: "spendingExport", build: spendingExportPage,
    blurb: "Export one person's spending as a horizontal spreadsheet: one " +
      "row per month, one column per category, $0 filled in for a month " +
      "with no activity.",
    group: "reports", groupLabel: "Reports",
  },
  {
    id: "shared", title: "Shared Expenses", icon: "split", key: "sharedExpenses",
    build: sharedExpensesPage,
    blurb: "Split transactions in your shared categories between two people, " +
      "as native YNAB splits.",
    group: "together", groupLabel: "Together",
  },
  {
    id: "splitsheet", title: "Bill Splitting", icon: "sheet", key: "splitSheet",
    build: splitSheetPage,
    blurb: "Work out whose expense each transaction was and export one row " +
      "per expense for a shared expense tracker.",
    group: "together", groupLabel: "Together",
  },
  {
    id: "cardrewards", title: "Card Rewards", icon: "wallet", key: "cardRewards",
    build: cardRewardsPage,
    blurb: "Search for a shop and see which of your credit cards gives you " +
      "the most back there.",
    group: "cards", groupLabel: "Card Rewards",
  },
];

export const SETUP_PAGE = {
  id: "setup", title: "Settings", icon: "settings", build: setupPage,
};

export const TOGGLEABLE = PAGES.filter((page) => page.key);

class App {
  constructor() {
    this.state = new AppState();
    this.current = null;
    this.busyCount = 0;

    this.nav = document.getElementById("nav");
    this.bottomNav = document.getElementById("bottom-nav");
    this.spaceTabs = document.getElementById("space-tabs");
    this.topbar = document.querySelector(".topbar");
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

    // One place for a tool's own settings: a gear next to Help, shown when
    // the open page registers some with usePageSettings(). Settings that
    // change everything stay on the Settings page.
    this.pageSettings = null;
    this.settingsButton = document.getElementById("page-settings-button");
    this.settingsButton.append(icon("settings", { size: 17 }), el("span", { text: "Settings" }));
    this.settingsButton.addEventListener("click", () => this.openPageSettings());

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

    // Sticky bars under the top bar (a page's action row) need to know how
    // tall it is, and the row of tabs makes that vary by space.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty("--topbar-height", `${this.topbar.offsetHeight}px`);
    }).observe(this.topbar);

    this.state.subscribe(() => this.refreshChrome());
    this.state.store.subscribe(() => this.buildNav());

    window.addEventListener("hashchange", () => this.routeFromHash());

    // On a phone, Enter in a field outside a form acts as "Next" and jumps
    // to the next field on the page, often far down it (reported live on
    // Card Rewards: Enter took you to the bottom). Outside a form, Enter
    // just closes the keyboard and stays put. Fields that give Enter a job
    // of their own call preventDefault first; inside a form (every dialog)
    // Enter still submits.
    document.addEventListener("keydown", (event) => {
      const field = event.target;
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      if (!(field instanceof HTMLInputElement) || field.form) return;
      if (["checkbox", "radio", "button", "submit", "file"].includes(field.type)) return;
      event.preventDefault();
      field.blur();
    });

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

  /** Every tool page, switched on or not. */
  toolPages() {
    return TOGGLEABLE;
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

  // ---------- spaces ----------

  pageById(id) {
    return [...PAGES, SETUP_PAGE].find((page) => page.id === id) || null;
  }

  pageVisible(id) {
    const page = this.pageById(id);
    return Boolean(page) && (!page.key || this.toolEnabled(page.key));
  }

  /** A space's tabs whose tool is switched on. */
  spaceTabsFor(space) {
    return space.tabs.filter((tab) => this.pageVisible(tab.page));
  }

  /** Spaces with at least one tool switched on, in order. */
  visibleSpaces() {
    return SPACES.filter((space) => this.spaceTabsFor(space).length);
  }

  spaceOfPage(id) {
    return SPACES.find((space) => space.tabs.some((tab) => tab.page === id)) || null;
  }

  /** Whether `tab` is the one on screen. */
  tabActive(tab) {
    if (this.current !== tab.page) return false;
    return !tab.tab || (this.state.store.get("reports.reportTab", "spending") || "spending") === tab.tab;
  }

  openTab(tab) {
    if (tab.tab) {
      // Reports' own tabs: the page reads which one to show from here.
      this.state.store.set("reports.reportTab", tab.tab);
      if (this.current === tab.page) return this.refresh();
    }
    this.go(tab.page);
  }

  /** A space opens where it was last left, else on its first tab. */
  openSpace(space) {
    const tabs = this.spaceTabsFor(space);
    const last = (this.state.store.get("nav.last", {}) || {})[space.id];
    const remembered = last && tabs.find((t) => t.page === last.page && (t.tab || "") === (last.tab || ""));
    this.openTab(remembered || tabs[0]);
  }

  rememberTab() {
    const space = this.spaceOfPage(this.current);
    if (!space) return;
    const tab = space.tabs.find((t) => this.tabActive(t));
    if (!tab) return;
    const last = { ...(this.state.store.get("nav.last", {}) || {}) };
    if (last[space.id]?.page === tab.page && (last[space.id]?.tab || "") === (tab.tab || "")) return;
    last[space.id] = { page: tab.page, tab: tab.tab || "" };
    this.state.store.set("nav.last", last);
  }

  /** The spaces in the phone's bottom bar: up to four, the rest under More. */
  barSpaces() {
    const visible = this.visibleSpaces();
    const chosen = (this.state.store.get("nav.bar", null) || DEFAULT_BAR)
      .map((id) => visible.find((space) => space.id === id))
      .filter(Boolean);
    for (const space of visible) {
      if (chosen.length >= 4) break;
      if (!chosen.includes(space)) chosen.push(space);
    }
    return chosen.slice(0, 4);
  }

  // The sidebar (wide screens) lists spaces; the bottom bar (phones and
  // tablets, see app.css) lists four of them plus More. Both are rebuilt on
  // every page change and settings change, which is cheap at this size.
  buildNav() {
    const current = this.current === SETUP_PAGE.id ? null : this.spaceOfPage(this.current);

    clear(this.nav);
    for (const space of this.visibleSpaces()) {
      this.nav.append(this.navButton(space.title, space.icon, space === current, () => this.openSpace(space)));
    }
    clear(this.navSetup).append(this.navButton(SETUP_PAGE.title, SETUP_PAGE.icon,
      this.current === SETUP_PAGE.id, () => this.go(SETUP_PAGE.id)));

    const bar = this.barSpaces();
    clear(this.bottomNav);
    for (const space of bar) {
      this.bottomNav.append(this.barButton(space.short || space.title, space.icon, space === current, () => this.openSpace(space)));
    }
    const inMore = !current || !bar.includes(current);
    this.bottomNav.append(this.barButton("More", "more", inMore, () => this.openMore()));

    this.buildSpaceTabs(current);
  }

  buildSpaceTabs(space) {
    clear(this.spaceTabs);
    const tabs = space ? this.spaceTabsFor(space) : [];
    // One tool in the space: its title says it all, no tab row needed.
    this.spaceTabs.hidden = tabs.length < 2;
    if (tabs.length < 2) return;
    for (const tab of tabs) {
      const active = this.tabActive(tab);
      this.spaceTabs.append(el("button", {
        type: "button",
        class: `space-tab${active ? " is-active" : ""}`,
        role: "tab",
        "aria-selected": String(active),
        text: tab.label || this.pageById(tab.page).title,
        onClick: () => this.openTab(tab),
      }));
    }
    // Keep the open tab in view when the row scrolls sideways on a phone.
    this.spaceTabs.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  navButton(text, iconName, active, onClick) {
    return el("button", {
      type: "button",
      class: "nav-item",
      title: text,
      "aria-current": active ? "page" : null,
      onClick,
    }, icon(iconName), el("span", { text }));
  }

  barButton(text, iconName, active, onClick) {
    return el("button", {
      type: "button",
      class: `bottom-nav-item${active ? " is-active" : ""}`,
      "aria-current": active ? "page" : null,
      onClick,
    }, icon(iconName, { size: 22 }), el("span", { text }));
  }

  /** The spaces that did not fit in the bottom bar, plus Settings. */
  openMore() {
    const bar = this.barSpaces();
    const rest = this.visibleSpaces().filter((space) => !bar.includes(space));
    const close = () => document.getElementById("dialog").dispatchEvent(new Event("cancel"));
    customDialog("More", (body) => {
      const list = el("div", { class: "more-list" });
      const item = (text, iconName, onClick) => el("button", {
        type: "button",
        class: "more-item",
        onClick: () => {
          close();
          onClick();
        },
      }, icon(iconName), el("span", { text }));
      for (const space of rest) list.append(item(space.title, space.icon, () => this.openSpace(space)));
      list.append(item(SETUP_PAGE.title, SETUP_PAGE.icon, () => this.go(SETUP_PAGE.id)));
      body.append(list);
    }, { confirmText: "Close", hideCancel: true, sheet: true });
  }

  routeFromHash() {
    const id = (location.hash || "").replace(/^#\/?/, "") || null;
    this.show(this.pageById(id) ? id : this.defaultPage());
  }

  defaultPage() {
    // Home when there is something to come home to, Settings otherwise.
    return this.state.token && this.state.budgetId ? "home" : "setup";
  }

  go(id) {
    if (location.hash === `#/${id}`) this.show(id);
    else location.hash = `#/${id}`;
  }

  show(id) {
    const page = this.pageById(id);
    if (!page) return this.show(this.defaultPage());

    // A tool switched off while open falls back to Home.
    if (page.key && !this.toolEnabled(page.key)) return this.go("home");

    this.current = id;
    // A space with several tabs is titled by the space; the tab row says
    // which tool. A single-tool space is titled by the tool.
    const space = this.spaceOfPage(id);
    const spaceTitle = space && this.spaceTabsFor(space).length > 1 ? space.title : page.title;
    this.title.textContent = spaceTitle;
    document.title = `${page.title} - YNAB Toolkit`;

    this.pageSettings = null;
    clear(this.pageHost).append(page.build(this));
    this.settingsButton.hidden = !this.pageSettings;
    this.pageHost.focus({ preventScroll: true });
    this.rememberTab();
    this.buildNav();
    this.refreshChrome();
  }

  /**
   * Called by a page while it builds: its settings, opened from the gear in
   * the top bar as a panel (a bottom sheet on a phone).
   * build(body) fills the panel; changes save as they are made. onDone runs
   * when it closes, for a page that needs to redraw.
   */
  usePageSettings({ build, onDone }) {
    this.pageSettings = { build, onDone };
  }

  async openPageSettings() {
    const settings = this.pageSettings;
    if (!settings) return;
    const page = this.pageById(this.current);
    await customDialog(`${page?.title || ""} settings`, (body) => {
      settings.build(body);
    }, { confirmText: "Done", hideCancel: true, sheet: true });
    settings.onDone?.();
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
    const pageTitle = this.pageById(this.current)?.title || this.title.textContent;
    const pageSection = intro ? `${pageTitle}\n${intro}\n\n` : "";

    alertDialog("YNAB Toolkit",
      pageSection +
      "Everything runs in your browser. There is no server: your token and " +
      "settings never leave this device, and the only requests made are to " +
      "api.ynab.com with your own token.\n\n" +
      "Getting started\n" +
      "Open Settings and paste a YNAB personal access token. Create one at " +
      "ynab.com under Account Settings > Developer Settings > New Token. " +
      "Then pick your budget.\n\n" +
      "Keeping your settings\n" +
      "Settings live in this browser's storage, which clearing browsing " +
      "data will erase. Use Back up settings on the Settings page to save them " +
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

// Installable as a phone app (see sw.js). Browsers only allow a service
// worker on https or localhost, so a file:// copy simply goes without.
if ("serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

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
