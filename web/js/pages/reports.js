// Reports: monthly spending, with filters you can name and keep.

import { fmt } from "../money.js";
import * as reports from "../tools/reports.js";
import { ownerOf } from "../tools/split_sheet.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, el, emptyRow,
  field, hint, logPane, monthLabel as monthLabelLong, monthOptions, monthsAgo,
  monthsAgoIso, pageHeading, radioGroup, sectionTitle, select, table,
  textInput, thisMonth, todayIso,
} from "../ui.js";

const LOG_EMPTY =
  "Reading your history now. This page only reads: it never changes your " +
  "budget.";

const TOP = 10;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function previousMonth() {
  return monthsAgo(1);
}

/** The first and last calendar day of a "YYYY-MM" month. */
function monthBounds(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { since: `${y}-${pad2(m)}-01`, until: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

/** The first day of one "YYYY-MM" month to the last day of another. */
function rangeBounds(fromStr, toStr) {
  return { since: monthBounds(fromStr).since, until: monthBounds(toStr).until };
}

function ytdBounds() {
  return { since: `${new Date().getFullYear()}-01-01`, until: todayIso() };
}

function formatFriendly(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** How many calendar months a since/until pair touches, at least one. */
function monthSpan(sinceIso, untilIso) {
  const [sy, sm] = sinceIso.split("-").map(Number);
  const [uy, um] = untilIso.split("-").map(Number);
  return Math.max(1, (uy - sy) * 12 + (um - sm) + 1);
}

/** Every "YYYY-MM" from sinceIso's month to untilIso's month, inclusive. */
function monthsBetween(sinceIso, untilIso) {
  const [sy, sm] = sinceIso.split("-").map(Number);
  const [uy, um] = untilIso.split("-").map(Number);
  const months = [];
  let y = sy;
  let m = sm;
  while (y < uy || (y === uy && m <= um)) {
    months.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

export function reportsPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("reports");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let entries = null;   // flattened transactions, kept so filters re-run free
  // Saving mode's own data: assigned (budgeted) amounts per category, one
  // entry per month in the report's date range - fetched separately from
  // entries since it comes from state.month(), not the transaction list.
  // Refetched whenever the covered range changes; monthlyRange remembers
  // which since/until it was last built for.
  let monthlyCategories = null;
  let monthlyRange = "";

  root.append(pageHeading(
    "Reports",
    "Where the money went, month by month. Filter to one person and save " +
    "the filter so the same report is one click next time."));

  // ---------- period ----------
  //
  // since/until are what every filter actually runs on. Month, Range and
  // YTD each compute them from their own inputs; Custom is those two dates
  // typed directly. Switching mode keeps whichever raw values that mode
  // last had, so flipping back and forth does not lose anything.

  // A brand new visitor sees last month, for everyone: the one range that
  // is always meaningful, whatever their budget looks like.
  if (!settings.periodMonth) settings.periodMonth = previousMonth();
  if (!settings.rangeFrom) settings.rangeFrom = monthsAgo(11);
  if (!settings.rangeTo) settings.rangeTo = thisMonth();
  if (!settings.since) settings.since = monthsAgoIso(12);
  if (!settings.until) settings.until = todayIso();

  const since = textInput(settings.since, { type: "date", onInput: onCustomDateInput });
  const until = textInput(settings.until, { type: "date", onInput: onCustomDateInput });

  // Dropdowns rather than the native <input type="month">, which renders
  // differently (and sometimes numerically) across browsers. A fixed list
  // also means every month reads "March 2026" consistently, and it only
  // goes back as far as this budget's own first month.
  const MONTH_OPTIONS = monthOptions(state.firstBudgetMonth);
  const earliestOption = MONTH_OPTIONS[MONTH_OPTIONS.length - 1]?.value;

  // A stored month from before the budget's start, or from a budget
  // switched away from, would otherwise select nothing in the dropdown.
  if (earliestOption) {
    if (settings.periodMonth < earliestOption) settings.periodMonth = earliestOption;
    if (settings.rangeFrom < earliestOption) settings.rangeFrom = earliestOption;
    if (settings.rangeTo < earliestOption) settings.rangeTo = earliestOption;
  }

  const monthInput = select(MONTH_OPTIONS, settings.periodMonth, (value) => {
    settings.periodMonth = value;
    periodChanged();
  });
  const rangeFromInput = select(MONTH_OPTIONS, settings.rangeFrom, (value) => {
    settings.rangeFrom = value;
    periodChanged();
  });
  const rangeToInput = select(MONTH_OPTIONS, settings.rangeTo, (value) => {
    settings.rangeTo = value;
    periodChanged();
  });

  const periodMode = radioGroup("report-period", [
    { value: "month", label: "Month" },
    { value: "range", label: "Range" },
    { value: "ytd", label: "YTD" },
    { value: "custom", label: "Custom" },
  ], settings.periodMode || "custom", (value) => {
    settings.periodMode = value;
    periodChanged();
  });

  const customRow = el("div", { class: "card-grid" },
    field("From", since), field("To", until));
  const monthRow = el("div", { class: "card-grid" }, field("Month", monthInput));
  const rangeRow = el("div", { class: "card-grid" },
    field("From month", rangeFromInput), field("To month", rangeToInput));
  const earliestNote = hint(state.firstBudgetMonth
    ? `This budget's data starts ${monthLabelLong(state.firstBudgetMonth)}.`
    : "Connect on the Setup page to limit this list to when your budget " +
      "actually starts.");

  function currentMode() {
    return settings.periodMode || "custom";
  }

  /** Recompute since/until from whichever inputs the current mode uses. */
  function applyPeriod() {
    const mode = currentMode();
    const bounds = mode === "month" ? monthBounds(settings.periodMonth)
      : mode === "range" ? rangeBounds(settings.rangeFrom, settings.rangeTo)
        : mode === "ytd" ? ytdBounds()
          : { since: settings.since, until: settings.until };
    settings.since = bounds.since;
    settings.until = bounds.until;
    since.value = settings.since;
    until.value = settings.until;
  }

  function paintPeriod() {
    const mode = currentMode();
    customRow.hidden = mode !== "custom";
    monthRow.hidden = mode !== "month";
    rangeRow.hidden = mode !== "range";
    earliestNote.hidden = mode !== "month" && mode !== "range";
    // From/To still show the effective dates outside Custom, just not
    // editable there: the computed range should always be visible.
    since.disabled = mode !== "custom";
    until.disabled = mode !== "custom";
  }

  function periodChanged() {
    applyPeriod();
    paintPeriod();
    store.save();
    reload();
  }

  const payee = textInput(settings.payeeContains, {
    placeholder: "any payee",
    onInput: () => {
      settings.payeeContains = payee.value;
      store.save();
      refresh();
    },
  });
  const payeeLabel = el("span", { class: "field-label", text: "Payee contains" });

  const owner = select([
    { value: "all", label: "Everyone" },
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
    { value: "shared", label: "Shared" },
  ], settings.owner || "all", (value) => {
    settings.owner = value;
    store.save();
    refresh();
  });

  const groupNote = hint("");
  const inflowBox = checkbox("Include income and refunds",
    settings.includeInflow, (checked) => {
      settings.includeInflow = checked;
      store.save();
      refresh();
    });
  const categoryButtonsRow = el("div", { class: "card-row" },
    button("Choose categories", { small: true, onClick: chooseCategories }),
    button("Clear", { small: true, onClick: () => {
      settings[categoryIdsKey()] = [];
      store.save();
      refresh();
    } }),
    groupNote);

  // Saving mode is the exact same report as Spending - same toEntries(),
  // same summarise(), same Whose/Payee/period/income controls - just
  // pointed at a different category selection. "Saving" is not a thing
  // YNAB's data model knows about; it is simply whichever categories you
  // have chosen here mean saving to you (an Investing category under a
  // Goals group, say), the same way Spending's own chooseCategories() lets
  // you narrow to whichever categories you meant by "spending". Two modes,
  // one mechanism, two separate remembered selections - not two different
  // report engines.
  const reportMode = radioGroup("report-mode", [
    { value: "spending", label: "Spending" },
    { value: "saving", label: "Saving" },
  ], settings.reportMode || "spending", (value) => {
    settings.reportMode = value;
    store.save();
    refresh();
  });

  const filtersCard = card(
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Report" }),
      reportMode),
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Period" }),
      periodMode),
    customRow, monthRow, rangeRow, earliestNote,
    el("div", { class: "card-grid" },
      field("Whose", owner), el("div", {}, payeeLabel, payee)),
    categoryButtonsRow,
    inflowBox);

  function savingMode() {
    return (settings.reportMode || "spending") === "saving";
  }

  // Spending and Saving each remember their own category selection
  // (settings.categoryIds vs settings.savingCategoryIds) - picking
  // "Investing" for Saving should not also narrow the Spending report, and
  // vice versa. Every other filter (Whose, Payee, period, income) is
  // shared between the two on purpose: those questions do not change
  // meaning depending on which categories you are looking at.
  function categoryIdsKey() {
    return savingMode() ? "savingCategoryIds" : "categoryIds";
  }

  function onCustomDateInput() {
    if (currentMode() !== "custom") return;
    settings.since = since.value;
    settings.until = until.value;
    store.save();
    reload();
  }

  function filters() {
    return {
      reportMode: settings.reportMode || "spending",
      since: settings.since,
      until: settings.until,
      // Carried along so a saved filter reproduces the period picker too,
      // not just the dates it happened to compute.
      periodMode: settings.periodMode || "custom",
      periodMonth: settings.periodMonth,
      rangeFrom: settings.rangeFrom,
      rangeTo: settings.rangeTo,
      owner: settings.owner,
      categoryIds: settings[categoryIdsKey()] || [],
      payeeContains: settings.payeeContains,
      includeInflow: settings.includeInflow,
    };
  }

  function paintGroupNote() {
    const chosen = (settings[categoryIdsKey()] || []).length;
    groupNote.textContent = chosen
      ? `${chosen} categor(ies) included.` : "All categories included.";
  }

  /**
   * Pick individual categories to include, grouped as YNAB shows them.
   * Used to sit alongside a separate "Exclude categories" dialog, but the
   * two were doing the same job from opposite ends - not choosing a
   * category already excludes it, so ticking everything except a couple
   * categories here (helped along by the group checkbox to start from
   * "everything") covers the "mostly all of them" case too. Removed
   * "Exclude categories" entirely at explicit user request rather than
   * keep two controls for one selection. Used to only offer whole groups;
   * moved to category granularity separately, with the group's own
   * checkbox left in as a "select all in this group" shortcut rather than
   * being the only unit you could pick. Shared by both report modes -
   * which underlying setting it reads/writes depends on categoryIdsKey(),
   * so choosing categories for Saving (e.g. an Investing category) never
   * touches Spending's own selection.
   */
  async function chooseCategories() {
    const groups = state.groups(true);
    if (!groups.length) {
      return log.write("Load a budget on the Setup page first.", "warn");
    }
    const current = new Set(settings[categoryIdsKey()] || []);
    const total = state.flatCategories(true).length;

    const chosen = await customDialog("Choose categories", (body) => {
      const boxes = [];
      const wrap = el("div", { style: "max-height:340px;overflow-y:auto" });

      for (const group of groups) {
        const inGroup = state.flatCategories(true)
          .filter((entry) => entry.group === group.name);
        if (!inGroup.length) continue;

        const groupBoxes = [];
        const groupBox = el("input", { type: "checkbox" });
        groupBox.checked = inGroup.every(
          ({ category }) => current.size === 0 || current.has(category.id));
        // Checking or unchecking the group's own box sets every category
        // inside it to match - a shortcut, not a separate level of
        // filtering, so nothing here reads groupBox.checked afterward.
        groupBox.addEventListener("change", () => {
          for (const box of groupBoxes) box.checked = groupBox.checked;
        });
        wrap.append(el("label", {
          class: "checkbox", style: "margin:12px 0 4px; font-weight:600",
        }, groupBox, el("span", {
          text: group.name + (group.hidden ? "  (hidden)" : ""),
        })));

        for (const { category } of inGroup) {
          const box = el("input", { type: "checkbox" });
          box.checked = current.size === 0 || current.has(category.id);
          boxes.push({ box, id: category.id });
          groupBoxes.push(box);
          wrap.append(el("label", {
            class: "checkbox", style: "padding:3px 0 3px 24px",
          }, box, el("span", {
            text: category.name + (category.hidden ? "  (hidden)" : ""),
          })));
        }
      }

      body.append(
        hint("Tick individual categories, or tick a group's own checkbox " +
          "to select every category inside it at once."),
        wrap);
      return {
        value: () => boxes.filter((entry) => entry.box.checked)
          .map((entry) => entry.id),
      };
    }, { confirmText: "Apply" });

    if (!chosen) return;
    // Everything ticked means no filter at all, which keeps saved filters
    // working when a new category is added to the budget later.
    settings[categoryIdsKey()] = chosen.length === total ? [] : chosen;
    store.save();
    refresh();
  }

  // ---------- filters section: saved views first, controls below ----------
  //
  // Modelled on Linear's saved views rather than a row of tags: each saved
  // filter is a named, readable row with its own actions, not a pill you
  // can only apply or throw away.
  //
  // A selected view stays selected while you edit the controls below it,
  // the same way Linear leaves a view selected while you adjust its
  // filters: that is what makes Update mean something. It is only cleared
  // by choosing a different view, deleting the active one, or Reset
  // filters, not by every keystroke.

  const savedList = el("div", { class: "saved-filter-list" });
  const resetButton = button("Reset filters", { small: true, onClick: resetFilters });
  const saveCurrentButton = button("Save as new", { small: true, onClick: saveCurrent });

  function saved() {
    return settings.saved || (settings.saved = []);
  }

  /** A short readable line for a filter, e.g. "March 2026   ·   Everyone". */
  function describeFilters(f) {
    const parts = [];
    if (f.reportMode === "saving") parts.push("Saving");
    if (f.periodMode === "month") parts.push(monthLabelLong(f.periodMonth));
    else if (f.periodMode === "range") {
      parts.push(`${monthLabelLong(f.rangeFrom)} to ${monthLabelLong(f.rangeTo)}`);
    } else if (f.periodMode === "ytd") parts.push("Year to date");
    else parts.push(`${formatFriendly(f.since)} to ${formatFriendly(f.until)}`);

    parts.push(f.owner === "all" ? "Everyone"
      : f.owner === "shared" ? "Shared"
        : state.personName(f.owner === "p1" ? 1 : 2));

    if (f.payeeContains) parts.push(`payee has "${f.payeeContains}"`);
    if ((f.categoryIds || []).length) {
      parts.push(`${f.categoryIds.length} categor(ies) only`);
    }
    if (f.includeInflow) parts.push("includes income");

    return parts.join("   ·   ");
  }

  function renderSaved() {
    clear(savedList);
    if (!saved().length) {
      savedList.append(hint(
        "No saved filters yet. Set the filters below up, then Save as new."));
      return;
    }

    saved().forEach((entry, index) => {
      const isActive = entry.name === settings.activeSavedName;
      const nameInput = textInput(entry.name, {
        onInput: () => renameSaved(index, nameInput.value),
      });
      nameInput.classList.add("saved-filter-name");
      nameInput.setAttribute("aria-label", `Name for saved filter, currently ${entry.name}`);

      const row = el("div", {
        class: isActive ? "saved-filter-row is-active" : "saved-filter-row",
      },
        el("div", { class: "saved-filter-main" },
          nameInput,
          el("p", { class: "hint saved-filter-summary", text: describeFilters(entry.filters) })),
        el("div", { class: "saved-filter-actions" },
          isActive
            ? el("span", { class: "pill pill-ok", text: "Applied" })
            : button("Apply", { small: true, onClick: () => applySaved(index) }),
          isActive
            ? button("Update", { small: true, onClick: () => updateSaved(index) })
            : null,
          button("Delete", { small: true, danger: true, onClick: () => removeSaved(index) })));

      savedList.append(row);
    });
  }

  /** Renaming happens in place. Typing straight into the row is the edit. */
  function renameSaved(index, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry = saved()[index];
    const wasActive = entry.name === settings.activeSavedName;
    entry.name = trimmed;
    if (wasActive) settings.activeSavedName = trimmed;
    store.save();
  }

  async function saveCurrent() {
    const name = await customDialog("Save as a new filter", (body) => {
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
    if (existing >= 0) {
      saved()[existing] = entry;
      log.write(`'${name}' already existed, so it was replaced.`, "warn");
    } else {
      saved().push(entry);
      log.write(`Saved the filter '${name}'.`, "ok");
    }
    settings.activeSavedName = name;
    store.save();
    renderSaved();
  }

  function applySaved(index) {
    const entry = saved()[index];
    settings.activeSavedName = entry.name;
    // filters()'s categoryIds is a generic name, already resolved to
    // whichever mode was active when the filter was saved (see filters()) -
    // Object.assign-ing it straight onto settings would land in the
    // *current* mode's key instead, silently overwriting the wrong one
    // (e.g. applying a saved Saving filter could clobber Spending's own
    // remembered categories). reportMode is applied first, then categoryIds
    // is routed to whichever key that mode actually reads.
    const { categoryIds, ...rest } = entry.filters;
    Object.assign(settings, rest);
    settings[categoryIdsKey()] = categoryIds || [];
    store.save();
    app.refresh();
  }

  /** Write the controls' current state back into the selected saved filter. */
  function updateSaved(index) {
    const entry = saved()[index];
    entry.filters = filters();
    store.save();
    renderSaved();
    log.write(`Updated '${entry.name}' with the current filters.`, "ok");
  }

  async function removeSaved(index) {
    const entry = saved()[index];
    const confirmed = await confirmDialog("Delete saved filter",
      `Delete '${entry.name}'? This does not change anything you are looking ` +
      "at right now.", { confirmText: "Delete" });
    if (!confirmed) return;
    saved().splice(index, 1);
    if (settings.activeSavedName === entry.name) settings.activeSavedName = "";
    store.save();
    renderSaved();
  }

  /** Back to what a filter section defaults to: last month, everyone. */
  function resetFilters() {
    settings.reportMode = "spending";
    settings.periodMode = "month";
    settings.periodMonth = previousMonth();
    settings.owner = "all";
    settings.payeeContains = "";
    settings.categoryIds = [];
    settings.savingCategoryIds = [];
    settings.includeInflow = false;
    settings.activeSavedName = "";
    store.save();
    app.refresh();
  }

  // ---------- results ----------

  const summaryNote = hint("");
  const statGrid = el("div", { class: "stat-grid" });

  // All four share this exact shape - label, Items, Spent - and the same
  // column classes, so their widths (set once in CSS) line up down the
  // page regardless of how long a payee name or category is. The month
  // table's bar lives inside the label cell, right next to the text it
  // belongs to, rather than off in a column of its own.
  function reportTable(labelHeading) {
    const wrap = table([
      { key: "label", label: labelHeading, className: "col-label" },
      { key: "count", label: "Items", className: "num col-items" },
      { key: "total", label: "Spent", className: "num col-spent" },
    ]);
    wrap.classList.add("report-table", "scroll-table");
    return wrap;
  }

  const monthTable = reportTable("Month");
  const groupTable = reportTable("Category group");
  const categoryTable = reportTable("Category");
  const payeeTable = reportTable("Payee");

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Filters"),
      el("span", { class: "spacer" }),
      resetButton, saveCurrentButton),
    savedList,
    filtersCard,
    summaryNote,
    statGrid,
    sectionTitle("By month"), monthTable,
    sectionTitle("Top category groups"), groupTable,
    sectionTitle("Top categories"), categoryTable,
    sectionTitle("Top payees"), payeeTable,
    log);

  /**
   * Read from the shared cache and re-summarise. Every tool draws its
   * transactions from one fetch made when you connected, so this is
   * normally instant; it only reaches YNAB again if the period picked
   * needs dates older than what is cached, or after Refresh in the header
   * asks everything to be re-read.
   */
  async function reload() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.",
        "error");
    }
    if (!state.hasBudgetData) {
      return log.write("Data is not loaded. Open Setup and press Reload data.",
        "error");
    }

    const fetched = await app.run(async () => state.transactions(settings.since),
      { log });
    if (!fetched) return;

    const groupOf = groupLookup();
    entries = reports.toEntries(fetched.list, groupOf, state.withPeople({}));
    await ensureMonthlyCategories();
    state.recordRun("reports");
    render();
  }

  /**
   * Saving mode reads YNAB's own Assigned figure per category per month
   * (`category.budgeted`), not transaction activity - see the comment on
   * summariseAssigned() for why. That means one state.month() per month in
   * the report's range, which entries (built once from the whole
   * transaction list) does not need. Cached per range so switching filters
   * that do not change since/until - Whose, which categories are chosen -
   * costs nothing more than a re-summarise.
   */
  async function ensureMonthlyCategories() {
    if (!savingMode()) return;
    const key = `${settings.since}|${settings.until}`;
    if (monthlyCategories && monthlyRange === key) return;

    const months = monthsBetween(settings.since, settings.until);
    const groupOf = groupLookup();
    const catNameOf = categoryLookup();
    const peopleSettings = state.withPeople({});

    const fetched = await app.run(() => Promise.all(months.map(async (month) => {
      const { data } = await state.month(month);
      const categories = (data.categories || [])
        .filter((c) => !c.deleted)
        .map((c) => ({
          id: c.id,
          name: catNameOf(c.id) || c.name,
          groupName: groupOf(c.id),
          budgeted: c.budgeted || 0,
          owner: ownerOf(groupOf(c.id), "", peopleSettings),
        }));
      return { month, categories };
    })), { log });

    if (!fetched) return;
    monthlyCategories = fetched;
    monthlyRange = key;
  }

  /** Re-summarise what is already in hand. Only reaches YNAB again if
   * Saving mode needs a month it has not fetched yet for this date range. */
  async function refresh() {
    if (!entries) return reload();
    await ensureMonthlyCategories();
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
    const saving = savingMode();

    if (!entries) {
      clear(statGrid).append(card(hint(
        "Connect and choose a budget on the Setup page to see your history.")));
      for (const node of [monthTable, groupTable, categoryTable, payeeTable]) {
        emptyRow(node, "Nothing yet.");
      }
      summaryNote.textContent = "";
      return;
    }

    // Filters re-apply instantly: the transactions (or, for Saving,
    // monthlyCategories) are already in hand, so changing one costs nothing
    // and never spends another API call by itself.
    const result = saving
      ? reports.summariseAssigned(monthlyCategories || [], filters())
      : reports.summarise(entries, filters(), {
        limit: TOP, categoryNameFor: categoryLookup(),
      });

    clear(statGrid).append(
      stat(saving ? "Total saved" : "Total spent", fmt(result.total)),
      saving
        ? stat("Categories", String(result.categories.length))
        : stat("Transactions", String(result.count)),
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
          el("td", { class: "col-label" },
            el("div", { class: "month-cell" },
              el("span", { class: "month-cell-name", text: monthLabel(row.month) }),
              bar(row.total / peak))),
          el("td", { class: "num col-items", text: String(row.count) }),
          el("td", { class: "num col-spent", text: fmt(row.total) })));
      }
    }

    fill(groupTable, result.groups);
    fill(categoryTable, result.categories);
    // Assigned money is not tied to any one transaction, so there is no
    // payee to break it down by - shown as an explanatory empty state
    // rather than hiding the table, the same 4-table shape either way.
    if (saving) {
      emptyRow(payeeTable, "Assigned amounts are not tied to a payee.");
    } else {
      fill(payeeTable, result.payees);
    }

    const who = settings.owner === "all" ? "everyone"
      : settings.owner === "shared" ? "shared expenses"
        : state.personName(settings.owner === "p1" ? 1 : 2);
    const span = monthSpan(settings.since, settings.until);
    summaryNote.textContent =
      `${formatFriendly(settings.since)} to ${formatFriendly(settings.until)} ` +
      `(${span} month${span === 1 ? "" : "s"})   ·   ${fmt(result.total)} for ${who}.`;
  }

  function fill(node, list) {
    clear(node.tbody);
    if (!list.length) return emptyRow(node, "Nothing matches those filters.");
    for (const row of list) {
      node.tbody.append(el("tr", {},
        el("td", { class: "col-label", text: row.name }),
        el("td", { class: "num col-items", text: String(row.count) }),
        el("td", { class: "num col-spent", text: fmt(row.total) })));
    }
  }

  function stat(label, value, note) {
    return el("div", { class: "stat" },
      el("span", { class: "stat-label", text: label }),
      el("span", { class: "stat-value", text: value }),
      note ? el("span", { class: "stat-note", text: note }) : null);
  }

  function bar(fraction) {
    return el("div", { class: "progress month-bar" },
      el("span", { style: `width:${Math.max(0, Math.round(fraction * 100))}%` }));
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      month: "short", year: "numeric",
    });
  }

  // ---------- first paint ----------
  //
  // Loads immediately, on whatever the defaults or last-used filters are:
  // usually an instant cache hit against the transactions fetched at
  // connect, so there is nothing to wait for and no button to press first.

  applyPeriod();
  paintPeriod();
  renderSaved();
  render();
  reload();

  return root;
}
