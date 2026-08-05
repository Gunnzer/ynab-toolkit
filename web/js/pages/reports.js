// Reports: monthly spending, with filters you can name and keep.

import { fmt } from "../money.js";
import * as reports from "../tools/reports.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, el, emptyRow,
  field, hint, logPane, monthsAgoIso, pageHeading, sectionTitle, select, table,
  textInput, todayIso,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing run yet. Pick a range and press Run. This page only reads: it " +
  "never changes your budget.";

const TOP = 10;

export function reportsPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("reports");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let entries = null;   // flattened transactions, kept so filters re-run free

  root.append(pageHeading(
    "Reports",
    "Where the money went, month by month. Filter to one person and save " +
    "the filter so the same report is one click next time."));

  // ---------- filters ----------

  if (!settings.since) settings.since = monthsAgoIso(12);
  if (!settings.until) settings.until = todayIso();

  const since = textInput(settings.since, { type: "date", onInput: save });
  const until = textInput(settings.until, { type: "date", onInput: save });
  const payee = textInput(settings.payeeContains, {
    placeholder: "any payee", onInput: save,
  });

  const owner = select([
    { value: "all", label: "Everyone" },
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
    { value: "shared", label: "Shared" },
  ], settings.owner || "all", (value) => {
    settings.owner = value;
    store.save();
    render();
  });

  const groupNote = hint("");
  const inflowBox = checkbox("Include income and refunds",
    settings.includeInflow,
    (checked) => { settings.includeInflow = checked; store.save(); render(); });

  root.append(card(
    el("div", { class: "card-grid" },
      field("From", since), field("To", until),
      field("Whose", owner), field("Payee contains", payee)),
    el("div", { class: "card-row" },
      button("Choose category groups", { small: true, onClick: chooseGroups }),
      button("Exclude categories", { small: true, onClick: chooseExclusions }),
      button("Clear both", { small: true, onClick: () => {
        settings.groupNames = [];
        settings.excludeCategoryIds = [];
        store.save();
        render();
      } }),
      groupNote),
    inflowBox));

  function save() {
    settings.since = since.value;
    settings.until = until.value;
    settings.payeeContains = payee.value;
    store.save();
    render();
  }

  function filters() {
    return {
      since: settings.since,
      until: settings.until,
      owner: settings.owner,
      groupNames: settings.groupNames || [],
      excludeCategoryIds: settings.excludeCategoryIds || [],
      payeeContains: settings.payeeContains,
      includeInflow: settings.includeInflow,
    };
  }

  function paintGroupNote() {
    const chosen = (settings.groupNames || []).length;
    const excluded = (settings.excludeCategoryIds || []).length;
    const parts = [
      chosen ? `${chosen} group(s) included` : "All category groups included",
    ];
    if (excluded) parts.push(`${excluded} categor(ies) excluded`);
    groupNote.textContent = `${parts.join(", ")}.`;
  }

  /** Pick individual categories to leave out, grouped as YNAB shows them. */
  async function chooseExclusions() {
    if (!state.hasBudgetData) {
      return log.write("Load a budget on the Setup page first.", "warn");
    }

    const excluded = new Set(settings.excludeCategoryIds || []);
    const chosen = await customDialog("Exclude categories", (body) => {
      const boxes = [];
      const wrap = el("div", { style: "max-height:340px;overflow-y:auto" });

      for (const group of state.groups()) {
        const inGroup = state.flatCategories()
          .filter((entry) => entry.group === group.name);
        if (!inGroup.length) continue;

        wrap.append(el("p", {
          class: "field-label",
          style: "margin:12px 0 4px",
          text: group.name,
        }));
        for (const { category } of inGroup) {
          const box = el("input", { type: "checkbox" });
          box.checked = excluded.has(category.id);
          boxes.push({ box, id: category.id });
          wrap.append(el("label", {
            class: "checkbox", style: "padding:3px 0 3px 12px",
          }, box, el("span", { text: category.name })));
        }
      }

      body.append(
        hint("Ticked categories are left out of the report. Anything you " +
          "add to the budget later is included by default."),
        wrap);

      return {
        value: () => boxes.filter((entry) => entry.box.checked)
          .map((entry) => entry.id),
      };
    }, { confirmText: "Apply" });

    if (!chosen) return;
    settings.excludeCategoryIds = chosen;
    store.save();
    render();
  }

  async function chooseGroups() {
    const groups = state.groups();
    if (!groups.length) {
      return log.write("Load a budget on the Setup page first.", "warn");
    }
    const current = new Set(settings.groupNames || []);
    const chosen = await customDialog("Category groups", (body) => {
      const boxes = [];
      const wrap = el("div", { style: "max-height:340px;overflow-y:auto" });
      for (const group of groups) {
        const box = el("input", { type: "checkbox" });
        box.checked = current.size === 0 || current.has(group.name);
        boxes.push(box);
        wrap.append(el("label", { class: "checkbox", style: "padding:4px 0" },
          box, el("span", { text: group.name })));
      }
      body.append(hint("Tick the groups to include."), wrap);
      return {
        value: () => groups
          .filter((_group, index) => boxes[index].checked)
          .map((group) => group.name),
      };
    }, { confirmText: "Apply" });

    if (!chosen) return;
    // Everything ticked means no filter at all, which keeps saved filters
    // working when a new group is added to the budget later.
    settings.groupNames = chosen.length === groups.length ? [] : chosen;
    store.save();
    render();
  }

  // ---------- saved filters ----------

  const savedRow = el("div", { class: "card-row" });
  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Saved filters"),
      el("span", { class: "spacer" }),
      button("Save current", { small: true, onClick: saveCurrent })),
    savedRow);

  function saved() {
    return settings.saved || (settings.saved = []);
  }

  function renderSaved() {
    clear(savedRow);
    if (!saved().length) {
      savedRow.append(hint("None yet. Set the filters up, then Save current."));
      return;
    }
    saved().forEach((entry, index) => {
      savedRow.append(el("span", { class: "chip" },
        el("button", {
          type: "button", class: "chip-main", text: entry.name,
          onClick: () => applySaved(index),
        }),
        el("button", {
          type: "button", class: "chip-remove", title: `Remove ${entry.name}`,
          "aria-label": `Remove ${entry.name}`, text: "×",
          onClick: () => removeSaved(index),
        })));
    });
  }

  async function saveCurrent() {
    const name = await customDialog("Save this filter", (body) => {
      const input = textInput("", { placeholder: "For example: my spending" });
      const error = el("p", { class: "hint is-error" });
      body.append(field("Name", input), error);
      setTimeout(() => input.focus(), 0);
      return {
        validate: () => {
          if (!input.value.trim()) {
            error.textContent = "A name is required.";
            return false;
          }
          return true;
        },
        value: () => input.value.trim(),
      };
    }, { confirmText: "Save" });

    if (!name) return;
    const entry = { name, filters: filters() };
    const existing = saved().findIndex((item) => item.name === name);
    if (existing >= 0) saved()[existing] = entry;
    else saved().push(entry);
    store.save();
    renderSaved();
    log.write(`Saved the filter '${name}'.`, "ok");
  }

  function applySaved(index) {
    const entry = saved()[index];
    Object.assign(settings, entry.filters);
    store.save();
    app.refresh();
  }

  async function removeSaved(index) {
    const entry = saved()[index];
    const confirmed = await confirmDialog("Remove saved filter",
      `Remove '${entry.name}'?`, { confirmText: "Remove" });
    if (!confirmed) return;
    saved().splice(index, 1);
    store.save();
    renderSaved();
  }

  // ---------- run ----------

  const runButton = button("Run", { accent: true, onClick: run });
  const summaryNote = hint("");
  root.append(el("div", { class: "card-row" }, runButton, summaryNote));

  const statGrid = el("div", { class: "stat-grid" });
  const monthTable = table([
    { key: "month", label: "Month" },
    { key: "bar", label: "" },
    { key: "count", label: "Items", className: "num" },
    { key: "total", label: "Spent", className: "num" },
  ]);
  const groupTable = table([
    { key: "name", label: "Category group" },
    { key: "count", label: "Items", className: "num" },
    { key: "total", label: "Spent", className: "num" },
  ]);
  const categoryTable = table([
    { key: "name", label: "Category" },
    { key: "count", label: "Items", className: "num" },
    { key: "total", label: "Spent", className: "num" },
  ]);
  const payeeTable = table([
    { key: "name", label: "Payee" },
    { key: "count", label: "Items", className: "num" },
    { key: "total", label: "Spent", className: "num" },
  ]);

  root.append(
    statGrid,
    sectionTitle("By month"), monthTable,
    sectionTitle("Top category groups"), groupTable,
    sectionTitle("Top categories"), categoryTable,
    sectionTitle("Top payees"), payeeTable,
    log);

  async function run() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.",
        "error");
    }
    if (!state.hasBudgetData) {
      return log.write("Categories are not loaded. Open Setup and press " +
        "Reload categories.", "error");
    }

    log.clearLog();
    log.write(`Reading transactions since ${settings.since} ...`, "head");

    const fetched = await app.run(async () => {
      const client = state.requireClient();
      return client.transactions(state.budgetId, settings.since);
    }, { log, buttons: [runButton] });
    if (!fetched) return;

    const groupOf = groupLookup();
    entries = reports.toEntries(fetched, groupOf, state.withPeople({}));
    log.write(`${fetched.length} transaction(s), ${entries.length} line(s) ` +
      "after splitting.", "ok");
    state.recordRun("reports");
    render();
  }

  function groupLookup() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, group.name);
    }
    return (id) => map.get(id) || "";
  }

  function categoryLookup() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, category.name);
    }
    return (id) => map.get(id) || "";
  }

  // ---------- rendering ----------

  function render() {
    paintGroupNote();
    if (!entries) {
      clear(statGrid).append(card(hint("Press Run to read your history.")));
      for (const node of [monthTable, groupTable, categoryTable, payeeTable]) {
        emptyRow(node, "Nothing yet.");
      }
      summaryNote.textContent = "";
      return;
    }

    // Filters re-apply instantly: the transactions are already in hand, so
    // changing one costs nothing and never spends another API call.
    const result = reports.summarise(entries, filters(), {
      limit: TOP, categoryNameFor: categoryLookup(),
    });

    clear(statGrid).append(
      stat("Total spent", fmt(result.total)),
      stat("Transactions", String(result.count)),
      stat("Average month", fmt(result.average)),
      stat("Biggest month", result.busiest
        ? `${monthLabel(result.busiest.month)}` : "n/a",
      result.busiest ? fmt(result.busiest.total) : ""));

    const peak = Math.max(1, ...result.monthly.map((row) => row.total));
    clear(monthTable.tbody);
    if (!result.monthly.length) {
      emptyRow(monthTable, "Nothing matches those filters.");
    } else {
      for (const row of result.monthly) {
        monthTable.tbody.append(el("tr", {},
          el("td", { text: monthLabel(row.month) }),
          el("td", {}, bar(row.total / peak)),
          el("td", { class: "num", text: String(row.count) }),
          el("td", { class: "num", text: fmt(row.total) })));
      }
    }

    fill(groupTable, result.groups);
    fill(categoryTable, result.categories);
    fill(payeeTable, result.payees);

    const who = settings.owner === "all" ? "everyone"
      : settings.owner === "shared" ? "shared expenses"
        : state.personName(settings.owner === "p1" ? 1 : 2);
    summaryNote.textContent =
      `${fmt(result.total)} across ${result.monthly.length} month(s) for ${who}.`;
  }

  function fill(node, list) {
    clear(node.tbody);
    if (!list.length) return emptyRow(node, "Nothing matches those filters.");
    for (const row of list) {
      node.tbody.append(el("tr", {},
        el("td", { text: row.name }),
        el("td", { class: "num", text: String(row.count) }),
        el("td", { class: "num", text: fmt(row.total) })));
    }
  }

  function stat(label, value, note) {
    return el("div", { class: "stat" },
      el("span", { class: "stat-label", text: label }),
      el("span", { class: "stat-value", text: value }),
      note ? el("span", { class: "stat-note", text: note }) : null);
  }

  function bar(fraction) {
    return el("div", { class: "progress bar-wide" },
      el("span", { style: `width:${Math.max(0, Math.round(fraction * 100))}%` }));
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      month: "short", year: "numeric",
    });
  }

  // ---------- first paint ----------

  renderSaved();
  render();

  return root;
}
