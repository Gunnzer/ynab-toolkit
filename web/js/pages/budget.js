// Budget: a read-only look at one month.
//
// This page never writes. It exists to answer "where does the budget
// actually stand" before you point one of the other tools at it, and to be
// the one place that knows a category's API id.

import { fmt } from "../money.js";
import { ownerOf, payerOf } from "../tools/split_sheet.js";
import {
  button, card, checkbox, clear, download, el, emptyRow, field, hint,
  logPane, monthOptions, pageActions, pageHeading, pill, sectionTitle,
  select, table, textInput, thisMonth,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing loaded yet. Pick a month above to load it. This page only " +
  "reads: it never changes your budget.";

/** A headline number with its label. */
function stat(label, value, { kind = "", note = "" } = {}) {
  return el("div", { class: "stat" },
    el("span", { class: "stat-label", text: label }),
    el("span", { class: `stat-value ${kind ? `is-${kind}` : ""}`, text: value }),
    note ? el("span", { class: "stat-note", text: note }) : null);
}

/** How far a category has got towards its target, 0 to 1. */
function targetProgress(category) {
  const target = category.goal_target;
  if (!target || target <= 0) return null;
  const done = (category.goal_overall_funded ?? category.budgeted) || 0;
  return Math.max(0, Math.min(1, done / target));
}

export function budgetPage(app) {
  const state = app.state;
  const store = state.store;

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);
  let month = null;        // MonthDetail from the API
  let monthKey = "";

  root.append(pageHeading(
    "Budget",
    "Where this month stands: what is left to assign, what is overspent, " +
    "and what each category has. Nothing here writes to YNAB."));

  // ---------- controls ----------

  // Same dropdown as Reports, Bill Splitting and Classic Budget, not a
  // native date input. Loads as soon as a month is picked, no separate
  // Load button.
  const monthInput = select(monthOptions(state.firstBudgetMonth), thisMonth(),
    () => load());
  const loadedNote = hint("");

  // Same "Whose" filter as Reports and Classic Budget: which category
  // groups count, decided by the same person/group-prefix setup from the
  // Setup page. Lives at the top next to Month - not just below Categories
  // - because it narrows the whole page (stats, Needs attention, Accounts
  // and the category table alike), not one section's worth of rows.
  const ownerSelect = select([
    { value: "all", label: "Everyone" },
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
    { value: "shared", label: "Shared" },
  ], store.get("budgetOverview.owner", "all"), (value) => {
    store.set("budgetOverview.owner", value);
    renderStats();
    renderAttention();
    renderAccounts();
    renderCategories();
  });

  function groupOwner(groupName) {
    return ownerOf(groupName, "", state.withPeople({}));
  }

  /** Whose account this is: "p1", "p2" or "joint" - the same logic Bill
   * Splitting's settle-up math already uses (explicit account-owner
   * mapping first, then account tag, then the account name starting with
   * a person's name), read from Bill Splitting's own settings since
   * that's the only place this mapping is configured. "joint" is what
   * the "Whose" filter's "shared" option matches against here - an
   * account is never literally "shared" the way a category can be, it is
   * either someone's own or not attributed to a person at all. */
  function accountOwner(accountName) {
    const settings = {
      ...state.withPeople({}),
      accountOwners: store.get("splitSheet.accountOwners", {}) || {},
    };
    return payerOf(accountName, settings);
  }

  /** category id -> its group's name, built fresh each time since groups
   * can change between loads. */
  function groupNameById() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, group.name);
    }
    return map;
  }

  root.append(pageActions(el("div", { class: "card-row" },
    el("label", { class: "field-label", style: "margin:0", text: "Month" }),
    el("div", { class: "narrow" }, monthInput),
    el("label", { class: "field-label", style: "margin:0", text: "Whose" }),
    el("div", { class: "narrow" }, ownerSelect),
    button("Export CSV", { onClick: exportCategories }),
    loadedNote)));

  // ---------- headline ----------

  const statGrid = el("div", { class: "stat-grid" });
  root.append(statGrid);

  // ---------- needs attention ----------

  const attentionHost = el("div");
  root.append(
    sectionTitle("Needs attention"),
    hint("Overspending first, because it comes out of next month either way, " +
      "then anything still short of its target."),
    attentionHost);

  // ---------- accounts ----------

  const accountsTable = table([
    { key: "name", label: "Account" },
    { key: "type", label: "Type" },
    { key: "cleared", label: "Cleared", className: "num" },
    { key: "uncleared", label: "Uncleared", className: "num" },
    { key: "balance", label: "Balance", className: "num" },
  ]);
  root.append(sectionTitle("Accounts"), accountsTable);

  // ---------- categories ----------

  const search = textInput("", { placeholder: "Filter categories..." });
  search.addEventListener("input", renderCategories);
  const hiddenBox = checkbox(
    "Show hidden", store.get("explorer.includeHidden"), (checked) => {
      store.set("explorer.includeHidden", checked);
      renderCategories();
    });

  const categoryTable = table([
    { key: "name", label: "Group / Category" },
    { key: "target", label: "Target" },
    { key: "budgeted", label: "Assigned", className: "num" },
    { key: "activity", label: "Activity", className: "num" },
    { key: "balance", label: "Available", className: "num" },
    { key: "id", label: "" },
  ]);
  categoryTable.classList.add("scroll-table");
  const categoryStatus = hint("");

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Categories"),
      el("span", { class: "spacer" }),
      button("Collapse all", { small: true, onClick: () => setAllCollapsed(true) }),
      button("Expand all", { small: true, onClick: () => setAllCollapsed(false) })),
    hint("The same list the tools pick from. Click a group to roll it up; " +
      "which groups are rolled up is remembered. Copy ID gives you the id " +
      "the YNAB API uses, which is worth having when something goes wrong."),
    field("Filter", search),
    el("div", { class: "card-row" }, hiddenBox),
    categoryTable,
    categoryStatus,
    log);

  // ---------- collapsing ----------

  function collapsed() {
    return new Set(store.get("budgetOverview.collapsedGroups", []) || []);
  }

  function setCollapsed(set) {
    store.set("budgetOverview.collapsedGroups", [...set]);
    renderCategories();
  }

  function toggleGroup(id) {
    const set = collapsed();
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setCollapsed(set);
  }

  function setAllCollapsed(shouldCollapse) {
    setCollapsed(shouldCollapse
      ? new Set(visibleGroups().map((group) => group.id))
      : new Set());
  }

  // ---------- behaviour ----------

  function visibleGroups() {
    const includeHidden = hiddenBox.querySelector("input").checked;
    const owner = ownerSelect.value;
    return (state.categoryGroups || []).filter((group) =>
      !group.deleted &&
      (includeHidden || !group.hidden) &&
      group.name !== "Internal Master Category" &&
      (owner === "all" || groupOwner(group.name) === owner));
  }

  /** Month figures by category id, when a month has been loaded. */
  function monthCategory(id) {
    if (!month) return null;
    return (month.categories || []).find((entry) => entry.id === id) || null;
  }

  function renderStats() {
    clear(statGrid);
    if (!month) {
      statGrid.append(card(hint(
        "Press Load to read this month's figures from YNAB.")));
      return;
    }

    // Assigned and Activity are sums over categories, so they can be
    // recomputed for just one person's own categories. Ready to Assign,
    // Income and Age of Money cannot: none of them are scoped to a
    // category at all (Ready to Assign is specifically money that has not
    // been given a job yet), so there is no meaningful "Julian's Ready to
    // Assign" - they always show the whole budget's figure, and say so
    // once a person filter narrows everything else on the page.
    const owner = ownerSelect.value;
    const filtered = owner !== "all";
    let budgeted = month.budgeted || 0;
    let activity = month.activity || 0;
    if (filtered) {
      const groupName = groupNameById();
      const live = (month.categories || []).filter((category) =>
        !category.deleted && !category.hidden &&
        groupOwner(groupName.get(category.id) || "") === owner);
      budgeted = live.reduce((sum, category) => sum + (category.budgeted || 0), 0);
      activity = live.reduce((sum, category) => sum + (category.activity || 0), 0);
    }

    const ready = month.to_be_budgeted || 0;
    const wholeBudgetNote = filtered ? " (whole budget)" : "";
    statGrid.append(
      stat("Ready to assign", fmt(ready), {
        kind: ready < 0 ? "error" : ready > 0 ? "warn" : "ok",
        note: (ready < 0
          ? "More is assigned than you have"
          : ready > 0 ? "Still waiting for a job" : "Every dollar has a job") +
          wholeBudgetNote,
      }),
      stat("Assigned this month", fmt(budgeted)),
      stat("Activity", fmt(activity)),
      stat("Income", fmt(month.income || 0),
        filtered ? { note: "Whole budget" } : {}),
      stat("Age of money",
        month.age_of_money === null || month.age_of_money === undefined
          ? "n/a" : `${month.age_of_money} days`,
        { note: "How long money sits before it is spent" + wholeBudgetNote }));
  }

  function renderAttention() {
    clear(attentionHost);
    if (!month) {
      attentionHost.append(card(hint("Load a month to see this.")));
      return;
    }

    const groupName = groupNameById();
    const owner = ownerSelect.value;
    const live = (month.categories || []).filter(
      (category) => !category.deleted && !category.hidden &&
        (owner === "all" || groupOwner(groupName.get(category.id) || "") === owner));

    const overspent = live
      .filter((category) => (category.balance || 0) < 0)
      .sort((a, b) => a.balance - b.balance);

    const underfunded = live
      .filter((category) => (category.goal_under_funded || 0) > 0)
      .sort((a, b) => b.goal_under_funded - a.goal_under_funded);

    if (!overspent.length && !underfunded.length) {
      attentionHost.append(card(el("div", { class: "card-row" },
        pill("All clear", "ok"),
        el("span", { class: "grow", text:
          "Nothing is overspent and every target is funded." }))));
      return;
    }

    const totalOver = overspent.reduce((sum, c) => sum + c.balance, 0);
    const totalUnder = underfunded.reduce((sum, c) => sum + c.goal_under_funded, 0);

    const list = table([
      { key: "what", label: "" },
      { key: "category", label: "Category" },
      { key: "group", label: "Group" },
      { key: "amount", label: "Amount", className: "num" },
    ]);

    for (const category of overspent) {
      list.tbody.append(el("tr", {},
        el("td", {}, pill("Overspent", "error")),
        el("td", { text: category.name }),
        el("td", { class: "hint", text: groupName.get(category.id) || "" }),
        el("td", { class: "num is-error", text: fmt(category.balance) })));
    }
    for (const category of underfunded) {
      list.tbody.append(el("tr", {},
        el("td", {}, pill("Underfunded", "warn")),
        el("td", { text: category.name }),
        el("td", { class: "hint", text: groupName.get(category.id) || "" }),
        el("td", { class: "num is-warn", text: fmt(category.goal_under_funded) })));
    }

    const summary = el("div", { class: "card-row" });
    if (overspent.length) {
      summary.append(el("span", { class: "hint is-error", text:
        `${overspent.length} categor(ies) overspent by ${fmt(-totalOver)}.` }));
    }
    if (underfunded.length) {
      summary.append(el("span", { class: "hint is-warn", text:
        `${underfunded.length} short of target by ${fmt(totalUnder)}.` }));
    }
    if (underfunded.length && app.toolEnabled("autoAssign")) {
      summary.append(el("span", { class: "spacer" }));
      summary.append(button("Open Auto Assign", {
        small: true, onClick: () => app.go("autoassign"),
      }));
    }

    attentionHost.append(summary, list);
  }

  function renderAccounts() {
    const owner = ownerSelect.value;
    // An account is never literally "shared" the way a category can be -
    // it is either someone's own or not attributed to a person, so the
    // filter's "shared" option matches payerOf()'s "joint" here.
    const wanted = owner === "shared" ? "joint" : owner;
    const accounts = (state.accounts || []).filter((account) =>
      !account.deleted && !account.closed &&
      (owner === "all" || accountOwner(account.name) === wanted));

    if (!accounts.length) {
      emptyRow(accountsTable, !state.hasBudgetData
        ? "Connect and choose a budget on the Setup page first."
        : owner === "all"
          ? "No open accounts in this budget."
          : "No open accounts match that filter.");
      return;
    }

    clear(accountsTable.tbody);
    let total = 0;
    for (const account of accounts) {
      total += account.balance || 0;
      accountsTable.tbody.append(el("tr", {},
        el("td", { text: account.name }),
        el("td", { class: "hint", text: (account.type || "").replace(/_/g, " ") }),
        el("td", { class: "num", text: fmt(account.cleared_balance) }),
        el("td", { class: "num", text: fmt(account.uncleared_balance) }),
        el("td", {
          class: `num ${(account.balance || 0) < 0 ? "is-error" : ""}`,
          text: fmt(account.balance),
        })));
    }
    accountsTable.tbody.append(el("tr", { class: "total-row" },
      el("td", { text: `${accounts.length} open account(s)` }),
      el("td", {}), el("td", { class: "num" }), el("td", { class: "num" }),
      el("td", { class: "num", text: fmt(total) })));
  }

  function renderCategories() {
    if (!state.hasBudgetData) {
      emptyRow(categoryTable,
        "No categories loaded. Connect and choose a budget on the Setup page.");
      categoryStatus.textContent = "";
      return;
    }

    const query = search.value.trim().toLowerCase();
    const includeHidden = hiddenBox.querySelector("input").checked;
    const rolledUp = collapsed();
    clear(categoryTable.tbody);

    let groupCount = 0;
    let categoryCount = 0;

    for (const group of visibleGroups()) {
      const matches = (group.categories || []).filter((category) => {
        if (category.deleted) return false;
        if (category.hidden && !includeHidden) return false;
        if (!query) return true;
        return category.name.toLowerCase().includes(query) ||
          group.name.toLowerCase().includes(query);
      });
      if (!matches.length) continue;

      groupCount += 1;
      const monthOf = (category) => monthCategory(category.id) || category;
      const groupGoal = matches.reduce((sum, category) => sum + (monthOf(category).goal_target || 0), 0);
      const groupBudgeted = matches.reduce((sum, category) => sum + (monthOf(category).budgeted || 0), 0);
      const groupActivity = matches.reduce((sum, category) => sum + (monthOf(category).activity || 0), 0);
      const groupTotal = matches.reduce((sum, category) => sum + (monthOf(category).balance || 0), 0);

      // A search that matched inside a rolled up group has to show what it
      // matched, so filtering wins over the collapsed state.
      const isCollapsed = !query && rolledUp.has(group.id);

      categoryTable.tbody.append(el("tr", { class: "group-row" },
        el("td", {},
          el("button", {
            type: "button",
            class: "group-toggle",
            "aria-expanded": String(!isCollapsed),
            onClick: () => toggleGroup(group.id),
          },
          el("span", { class: "caret", "aria-hidden": "true", text: "▾" }),
          el("span", { text: group.name + (group.hidden ? "  (hidden)" : "") }),
          el("span", { class: "count", text: `${matches.length}` }))),
        el("td", { class: "num", text: groupGoal ? fmt(groupGoal) : "" }),
        el("td", { class: "num", text: fmt(groupBudgeted) }),
        el("td", { class: "num", text: fmt(groupActivity) }),
        el("td", { class: "num", text: fmt(groupTotal) }),
        el("td", {})));

      if (isCollapsed) {
        categoryCount += matches.length;
        continue;
      }

      for (const base of matches) {
        categoryCount += 1;
        const category = monthCategory(base.id) || base;
        const balance = category.balance || 0;
        const progress = targetProgress(category);

        categoryTable.tbody.append(el("tr", {},
          el("td", { class: "indent",
            text: base.name + (base.hidden ? "  (hidden)" : "") }),
          el("td", { class: "num" }, progress === null
            ? el("span", { class: "hint", text: "none" })
            : el("div", { class: "target-cell" },
                el("span", { text: fmt(category.goal_target) }),
                el("span", { class: `hint ${progress >= 1 ? "is-ok" : ""}`,
                  text: `${Math.round(progress * 100)}%` }))),
          el("td", { class: "num", text: fmt(category.budgeted) }),
          el("td", { class: "num", text: fmt(category.activity) }),
          el("td", {
            class: `num ${balance < 0 ? "is-error" : balance > 0 ? "is-ok" : ""}`,
            text: fmt(balance),
          }),
          el("td", {}, button("Copy ID", {
            small: true, onClick: () => copyId(base),
          }))));
      }
    }

    if (!categoryCount) {
      emptyRow(categoryTable, query
        ? `Nothing matches "${search.value.trim()}".`
        : "No categories to show.");
    }

    categoryStatus.textContent =
      `${groupCount} group(s), ${categoryCount} categor(ies) in ` +
      `'${state.budgetName}'` +
      (monthKey ? `, showing ${monthKey} figures.` : ".");
  }

  async function copyId(category) {
    try {
      await navigator.clipboard.writeText(category.id);
      categoryStatus.textContent = `Copied the ID for '${category.name}'.`;
    } catch {
      categoryStatus.textContent =
        `Could not use the clipboard. The ID is ${category.id}`;
    }
  }

  async function load() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }
    if (!/^\d{4}-\d{2}$/.test(monthInput.value)) {
      return log.write("Pick a valid month.", "error");
    }

    const wanted = monthInput.value;
    log.clearLog();
    log.write(`Reading ${wanted} ...`, "head");

    const result = await app.run(async () => {
      const client = state.requireClient();
      const data = { month: (await state.month(wanted)).data };
      // The category and account lists may be stale, or missing entirely if
      // the page was opened straight from a bookmark.
      if (!state.hasBudgetData) {
        data.groups = await client.categories(state.budgetId);
        data.accounts = await client.accounts(state.budgetId);
      }
      return data;
    }, { log });

    if (!result) return;

    month = result.month;
    monthKey = wanted;
    if (result.groups) state.categoryGroups = result.groups;
    if (result.accounts) state.accounts = result.accounts;

    loadedNote.textContent = `Showing ${wanted}.`;
    log.write(`Loaded ${(month.categories || []).length} categor(ies). ` +
      `${fmt(month.to_be_budgeted || 0)} ready to assign.`, "ok");

    state.notify();
    renderStats();
    renderAttention();
    renderAccounts();
    renderCategories();
  }

  function exportCategories() {
    if (!state.hasBudgetData) {
      return log.write("Nothing to export yet.", "warn");
    }
    const lines = ["Group,Group ID,Category,Category ID,Hidden,Assigned,Activity,Available"];
    const escape = (value) => /[",\n]/.test(String(value))
      ? `"${String(value).replace(/"/g, '""')}"` : String(value);

    for (const group of visibleGroups()) {
      for (const base of group.categories || []) {
        if (base.deleted) continue;
        const category = monthCategory(base.id) || base;
        lines.push([
          group.name, group.id, base.name, base.id,
          base.hidden ? "yes" : "no", fmt(category.budgeted),
          fmt(category.activity), fmt(category.balance),
        ].map(escape).join(","));
      }
    }
    const stamp = monthKey || "current";
    download(`ynab-categories-${stamp}.csv`, lines.join("\r\n"), "text/csv");
    log.write(`Exported ${lines.length - 1} categor(ies).`, "ok");
  }

  // ---------- first paint ----------

  renderStats();
  renderAttention();
  renderAccounts();
  renderCategories();
  if (state.token && state.budgetId) load();

  return root;
}
