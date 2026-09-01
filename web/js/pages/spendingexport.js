// Spending Export: one person's spending as a horizontal spreadsheet - one
// row per month, one column per category they own, $0 filled in for a
// category with no activity that month. Built for pasting into an external
// tracker or spreadsheet that expects every row to have the same columns,
// not for reading on screen the way Reports is.

import { fmt } from "../money.js";
import * as spendingExport from "../tools/spending_export.js";
import {
  button, card, checkbox, clear, download, el, emptyRow, field, hint,
  logPane, monthLabel as monthLabelLong, monthOptions, monthsAgo, pageHeading,
  radioGroup, select, table, thisMonth,
} from "../ui.js";

const LOG_EMPTY =
  "Reading your history now. This page only reads: it never changes your " +
  "budget.";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** The first and last calendar day of a "YYYY-MM" month. */
function monthBounds(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { since: `${y}-${pad2(m)}-01`, until: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

/** "YYYY-MM" -> "Mar 2026", compact enough for a table/CSV cell. */
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "short", year: "numeric",
  });
}

export function spendingExportPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("spendingExport");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let entries = null;
  let categories = [];
  let months = [];
  let rows = [];

  root.append(pageHeading(
    "Spending Export",
    "One person's spending, laid out as a horizontal spreadsheet: one row " +
    "per month, one column per category they own, $0 filled in for a " +
    "category with no activity that month so every row lines up the same " +
    "way."));

  if (!settings.owner) settings.owner = "p1";
  if (!settings.rangeFrom) settings.rangeFrom = monthsAgo(11);
  if (!settings.rangeTo) settings.rangeTo = thisMonth();

  const owner = radioGroup("spending-export-owner", [
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
  ], settings.owner, (value) => {
    settings.owner = value;
    store.save();
    refresh();
  });

  const MONTH_OPTIONS = monthOptions(state.firstBudgetMonth);
  const earliestOption = MONTH_OPTIONS[MONTH_OPTIONS.length - 1]?.value;
  if (earliestOption) {
    if (settings.rangeFrom < earliestOption) settings.rangeFrom = earliestOption;
    if (settings.rangeTo < earliestOption) settings.rangeTo = earliestOption;
  }

  const rangeFromInput = select(MONTH_OPTIONS, settings.rangeFrom, (value) => {
    settings.rangeFrom = value;
    store.save();
    reload();
  });
  const rangeToInput = select(MONTH_OPTIONS, settings.rangeTo, (value) => {
    settings.rangeTo = value;
    store.save();
    reload();
  });
  const earliestNote = hint(state.firstBudgetMonth
    ? `This budget's data starts ${monthLabelLong(state.firstBudgetMonth)}.`
    : "Connect on the Setup page to limit this list to when your budget " +
      "actually starts.");

  const inflowBox = checkbox("Include income and refunds",
    settings.includeInflow, (checked) => {
      settings.includeInflow = checked;
      store.save();
      refresh();
    });

  const filtersCard = card(
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Whose" }),
      owner),
    el("div", { class: "card-grid" },
      field("From month", rangeFromInput), field("To month", rangeToInput)),
    earliestNote,
    inflowBox);

  const summaryNote = hint("");
  const previewTable = table([]);
  previewTable.classList.add("scroll-table");

  const saveButton = button("Save CSV", { onClick: saveCsv, disabled: true });
  const copyButton = button("Copy", { onClick: copyRows, disabled: true });
  const actions = el("div", { class: "card-row" }, saveButton, copyButton);

  root.append(
    filtersCard,
    actions,
    summaryNote,
    previewTable,
    log);

  function filterSince() {
    return monthBounds(settings.rangeFrom).since;
  }
  function filterUntil() {
    return monthBounds(settings.rangeTo).until;
  }

  async function reload() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.",
        "error");
    }
    if (!state.hasBudgetData) {
      return log.write("Data is not loaded. Open Setup and press Reload data.",
        "error");
    }

    const fetched = await app.run(async () => state.transactions(filterSince()),
      { log });
    if (!fetched) return;

    entries = spendingExport.toEntries(fetched.list, groupLookup(), state.withPeople({}));
    state.recordRun("spendingExport");
    render();
  }

  function refresh() {
    if (!entries) return reload();
    render();
  }

  function groupLookup() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, group.name);
    }
    return (id) => map.get(id) || "";
  }

  function render() {
    if (!entries) {
      clear(previewTable.querySelector("thead"));
      previewTable.columns = [{}];
      clear(previewTable.tbody);
      emptyRow(previewTable, "Connect and choose a budget on the Setup page to see your history.");
      summaryNote.textContent = "";
      saveButton.disabled = true;
      copyButton.disabled = true;
      return;
    }

    categories = spendingExport.ownedCategories(
      state.categoryGroups, settings.owner, state.withPeople({}));
    months = spendingExport.monthsBetween(settings.rangeFrom, settings.rangeTo);
    rows = spendingExport.buildRows(entries, months, categories, settings.owner,
      { includeInflow: settings.includeInflow });

    drawTable();

    const who = state.personName(settings.owner === "p1" ? 1 : 2);
    if (!categories.length) {
      summaryNote.textContent =
        `${who} owns no categories yet - set up group prefixes or account ` +
        "tags on the Setup page first.";
      saveButton.disabled = true;
      copyButton.disabled = true;
      return;
    }

    const total = rows.reduce((sum, row) =>
      sum + categories.reduce((s, c) => s + (row[c.id] || 0), 0), 0);
    summaryNote.textContent =
      `${months.length} month(s), ${categories.length} categor(ies) for ` +
      `${who}   ·   ${fmt(total)} total.`;
    saveButton.disabled = false;
    copyButton.disabled = false;
  }

  function drawTable() {
    // The column set is dynamic (it follows whichever person is chosen),
    // unlike every other table() in the app - wrap.columns has to be kept
    // in sync by hand so emptyRow()'s colspan still spans the real table.
    previewTable.columns = [{}, ...categories];

    const thead = previewTable.querySelector("thead");
    clear(thead).append(el("tr", {},
      el("th", { text: "Month" }),
      ...categories.map((c) => el("th", { class: "num", text: c.label }))));

    clear(previewTable.tbody);
    if (!categories.length || !rows.length) {
      emptyRow(previewTable, "Nothing to show for those filters.");
      return;
    }

    for (const row of rows) {
      previewTable.tbody.append(el("tr", {},
        el("td", { text: monthLabel(row.month) }),
        // A $0 cell is left blank rather than printed as $0.00 - the
        // column stays put either way, only the value is empty, which
        // scans faster than a grid of zeroes once there are many columns.
        ...categories.map((c) => el("td", { class: "num", text: row[c.id] ? fmt(row[c.id]) : "" }))));
    }
  }

  function saveCsv() {
    if (!rows.length || !categories.length) return;
    const who = state.personName(settings.owner === "p1" ? 1 : 2);
    const filename = `${who.toLowerCase().replace(/\s+/g, "-")}-spending.csv`;
    download(filename, spendingExport.toCsv(categories, rows, monthLabel), "text/csv");
    log.write(`Saved ${filename} (${months.length} month(s), ` +
      `${categories.length} categor(ies)).`, "ok");
  }

  async function copyRows() {
    if (!rows.length || !categories.length) return;
    // Tab separated, which is what spreadsheets expect from a paste - same
    // approach Bill Splitting's Copy button uses.
    const text = spendingExport.toCsv(categories, rows, monthLabel)
      .split("\r\n").filter(Boolean).map((line) => splitCsvLine(line).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log.write(`Copied ${months.length} month(s). Paste straight into your ` +
        "tracker.", "ok");
    } catch {
      log.write("The clipboard was refused. Use Save CSV instead.", "warn");
    }
  }

  function splitCsvLine(line) {
    const out = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { out.push(field); field = ""; }
      else field += char;
    }
    out.push(field);
    return out;
  }

  render();
  reload();

  return root;
}
