// Classic Budget: your own planned amount per category, next to what YNAB
// itself has assigned, spent and left.
//
// "Budgeted" here is not a YNAB field. It is a plan you set yourself, and
// it applies to every month until you change it - there is no per-month
// history yet, only "the current plan". Setting it lets the Budgeted
// column tell you, at a glance, whether a category ran over that plan.

import { fmt, toMilliunits } from "../money.js";
import { ownerOf } from "../tools/split_sheet.js";
import {
  button, card, checkbox, clear, customDialog, el, emptyRow, field, hint,
  logPane, monthOptions, pageActions, pageHeading, pill, sectionTitle,
  select, table, textInput, thisMonth,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing loaded yet. Pick a month above to load it. This page only reads " +
  "YNAB; your planned amounts live in this browser.";

export function classicBudgetPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("classicBudget");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);
  let month = null;
  let monthKey = "";

  root.append(pageHeading(
    "Classic Budget",
    "Your categories with a plan of your own next to them: set what you " +
    "meant to spend, and see straight away whether a category ran over " +
    "that plan."));

  // ---------- controls ----------

  // Same dropdown as Reports and Bill Splitting, not a native date input:
  // one consistent way to pick a month across the app. Loads as soon as a
  // month is picked, no separate Load button. The choice is remembered
  // across refreshes, same as Reports.
  if (!settings.month) settings.month = thisMonth();
  const monthInput = select(monthOptions(state.firstBudgetMonth), settings.month,
    () => { settings.month = monthInput.value; store.save(); load(); });
  const loadedNote = hint("");

  root.append(pageActions(el("div", { class: "card-row" },
    el("label", { class: "field-label", style: "margin:0", text: "Month" }),
    el("div", { class: "narrow" }, monthInput),
    loadedNote)));

  // ---------- overbudget ----------

  const overbudgetHost = el("div");
  root.append(
    sectionTitle("Overbudget"),
    hint("Categories that spent more than the plan you set for them, in " +
      "the same order as the list below."),
    overbudgetHost);

  function renderOverbudget() {
    clear(overbudgetHost);
    if (!month) {
      overbudgetHost.append(card(hint("Pick a month above to see this.")));
      return;
    }

    const monthById = new Map((month.categories || []).map((c) => [c.id, c]));

    // Walk the same groups, in the same order, as the Categories table
    // below - including its Whose/hidden filters - rather than sorting by
    // how far over each one is, so the two lists always agree.
    const over = [];
    for (const group of visibleGroups()) {
      for (const base of group.categories || []) {
        const category = monthById.get(base.id);
        if (!category || category.deleted || category.hidden) continue;
        const planned = plannedFor(base.id);
        if (planned === null) continue;
        const spent = Math.max(0, -(category.activity || 0));
        const overBy = spent - planned;
        if (overBy > 0) over.push({ category, groupName: group.name, planned, overBy });
      }
    }

    if (!over.length) {
      overbudgetHost.append(card(el("div", { class: "card-row" },
        pill("All clear", "ok"),
        el("span", { class: "grow", text:
          "Nothing has gone over the plan you set for it." }))));
      return;
    }

    const totalOver = over.reduce((sum, entry) => sum + entry.overBy, 0);

    const list = table([
      { key: "category", label: "Category" },
      { key: "group", label: "Group" },
      { key: "planned", label: "Budgeted", className: "num" },
      { key: "amount", label: "Over by", className: "num" },
    ]);
    for (const { category, groupName, planned, overBy } of over) {
      list.tbody.append(el("tr", {},
        el("td", { text: category.name }),
        el("td", { class: "hint", text: groupName }),
        el("td", { class: "num", text: fmt(planned) }),
        el("td", { class: "num is-error", text: fmt(overBy) })));
    }

    overbudgetHost.append(
      el("div", { class: "card-row" },
        el("span", { class: "hint is-error", text:
          `${over.length} categor(ies) over budget by ${fmt(totalOver)}.` })),
      list);
  }

  // ---------- planned amounts ----------

  function plannedMap() {
    const byBudget = settings.plannedByBudget || (settings.plannedByBudget = {});
    return byBudget[state.budgetId] || (byBudget[state.budgetId] = {});
  }

  function plannedFor(categoryId) {
    const value = plannedMap()[categoryId];
    return typeof value === "number" ? value : null;
  }

  async function setPlannedAmounts() {
    if (!state.hasBudgetData) {
      return log.write("Load a budget on the Setup page first.", "warn");
    }
    const current = plannedMap();

    const result = await customDialog("Set budgeted amounts", (body) => {
      body.append(hint(
        "How much you plan to spend in each category. Applies from now " +
        "on, in every month, until you change it. Leave a field blank for " +
        "no plan."));
      const inputs = [];
      const wrap = el("div", { style: "max-height:360px;overflow-y:auto" });

      for (const group of state.groups()) {
        const categories = state.flatCategories()
          .filter((entry) => entry.group === group.name);
        if (!categories.length) continue;

        wrap.append(el("p", {
          class: "field-label", style: "margin:12px 0 4px", text: group.name,
        }));
        for (const { category } of categories) {
          const existing = current[category.id];
          const input = textInput(
            typeof existing === "number" ? fromMilliunitsPlain(existing) : "",
            { placeholder: "not set" });
          input.classList.add("narrow");
          inputs.push({ id: category.id, input });
          wrap.append(el("div", { class: "card-row", style: "padding:2px 0" },
            el("span", { class: "grow", text: category.name }), input));
        }
      }
      body.append(wrap);

      return {
        value: () => {
          for (const { id, input } of inputs) {
            const raw = input.value.trim();
            if (!raw) delete current[id];
            else current[id] = toMilliunits(raw);
          }
          return true;
        },
      };
    }, { confirmText: "Save" });

    if (!result) return;
    store.save();
    log.write("Budgeted amounts saved.", "ok");
    renderCategories();
  }

  function fromMilliunitsPlain(milliunits) {
    return (milliunits / 1000).toFixed(2);
  }

  // ---------- categories ----------

  const search = textInput("", { placeholder: "Filter categories..." });
  search.addEventListener("input", renderCategories);
  const hiddenBox = checkbox(
    "Show hidden", store.get("explorer.includeHidden"), (checked) => {
      store.set("explorer.includeHidden", checked);
      renderCategories();
    });
  const unbudgetedBox = checkbox(
    "Hide unbudgeted", store.get("classicBudget.hideUnbudgeted"), (checked) => {
      store.set("classicBudget.hideUnbudgeted", checked);
      renderCategories();
    });

  // Same "Whose" filter as Reports: which category groups count, decided
  // by the same person/group-prefix setup from the Setup page.
  const ownerSelect = select([
    { value: "all", label: "Everyone" },
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
    { value: "shared", label: "Shared" },
  ], settings.owner || "all", (value) => {
    settings.owner = value;
    store.save();
    renderCategories();
  });

  function groupOwner(groupName) {
    return ownerOf(groupName, "", state.withPeople(settings));
  }

  const categoryTable = table([
    { key: "name", label: "Group / Category" },
    { key: "planned", label: "Budgeted", className: "num" },
    { key: "activity", label: "Activity", className: "num" },
  ]);
  const categoryStatus = hint("");

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Categories"),
      el("span", { class: "spacer" }),
      button("Set budgeted amounts", { small: true, onClick: setPlannedAmounts }),
      button("Collapse all", { small: true, onClick: () => setAllCollapsed(true) }),
      button("Expand all", { small: true, onClick: () => setAllCollapsed(false) })),
    hint("Budgeted is a plan you set, not a YNAB figure. Activity is green " +
      "while spending stays under that plan, grey when it lands exactly on " +
      "it, and red once it goes over."),
    el("div", { class: "card-grid" },
      field("Filter", search), field("Whose", ownerSelect)),
    el("div", { class: "card-row" }, hiddenBox, unbudgetedBox),
    categoryTable,
    categoryStatus,
    log);

  // ---------- collapsing ----------

  function collapsed() {
    return new Set(store.get("classicBudget.collapsedGroups", []) || []);
  }

  function setCollapsed(set) {
    store.set("classicBudget.collapsedGroups", [...set]);
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

  function monthCategory(id) {
    if (!month) return null;
    return (month.categories || []).find((entry) => entry.id === id) || null;
  }

  function renderCategories() {
    renderOverbudget();
    if (!state.hasBudgetData) {
      emptyRow(categoryTable,
        "No categories loaded. Connect and choose a budget on the Setup page.");
      categoryStatus.textContent = "";
      return;
    }

    const query = search.value.trim().toLowerCase();
    const includeHidden = hiddenBox.querySelector("input").checked;
    const hideUnbudgeted = unbudgetedBox.querySelector("input").checked;
    const rolledUp = collapsed();
    clear(categoryTable.tbody);

    let groupCount = 0;
    let categoryCount = 0;

    for (const group of visibleGroups()) {
      const matches = (group.categories || []).filter((category) => {
        if (category.deleted) return false;
        if (category.hidden && !includeHidden) return false;
        if (hideUnbudgeted && plannedFor(category.id) === null) return false;
        if (!query) return true;
        return category.name.toLowerCase().includes(query) ||
          group.name.toLowerCase().includes(query);
      });
      if (!matches.length) continue;

      groupCount += 1;
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
        el("td", { class: "num" }), el("td", { class: "num" })));

      if (isCollapsed) {
        categoryCount += matches.length;
        continue;
      }

      for (const base of matches) {
        categoryCount += 1;
        const category = monthCategory(base.id) || base;
        const planned = plannedFor(base.id);

        // Activity is negative when money leaves the category; spent is
        // the plain positive amount that reads naturally against a plan.
        const spent = Math.max(0, -(category.activity || 0));
        const activityClass = planned === null ? ""
          : spent === 0 || spent === planned ? "is-muted"
            : spent > planned ? "is-error"
              : "is-ok";

        categoryTable.tbody.append(el("tr", {},
          el("td", { class: "indent",
            text: base.name + (base.hidden ? "  (hidden)" : "") }),
          el("td", {
            class: "num",
            text: planned === null ? "not set" : fmt(planned),
          }),
          el("td", { class: `num ${activityClass}`, text: fmt(spent) })));
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
    log.write(`Loaded ${(month.categories || []).length} categor(ies).`, "ok");

    state.notify();
    renderCategories();
  }

  // ---------- first paint ----------

  renderCategories();
  if (state.token && state.budgetId) load();

  return root;
}
