// Reports tab: Budget vs actual, plus how this month is pacing.

import { fmt } from "../money.js";
import * as ba from "../tools/budget_actual.js";
import {
  card, clear, el, emptyRow, hint, logPane, pill, sectionTitle, select, table,
} from "../ui.js";
import { categoryLink } from "./category_history_dialog.js";
import {
  assignableCategories, localMonth, ownerMatches, ownerSelect, stat,
} from "./report_kit.js";

const PERIODS = [
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
];

const STATUS = {
  under: { title: "Usually needs more than it gets", pill: ["Needs more", "error"] },
  over: { title: "Usually gets more than it needs", pill: ["Too much", "warn"] },
  saving: { title: "Saving up on purpose", pill: ["Saving up", "info"] },
  ok: { title: "On track", pill: ["On track", "ok"] },
};

export function budgetActualReport(app, { settings, store }) {
  const state = app.state;
  const log = logPane("Comparing what each category was given with what it spent.");
  let loaded = null;
  let showOnTrack = false;

  const period = select(PERIODS, settings.bvaMonths || "6", (value) => {
    settings.bvaMonths = value;
    store.save();
    load();
  });
  const owner = ownerSelect(state, settings.insightOwner, (value) => {
    settings.insightOwner = value;
    store.save();
    render();
  });

  const controls = card(
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Compare" }),
      el("div", { class: "narrow" }, period),
      el("span", { class: "field-label", style: "margin:0", text: "Whose" }),
      el("div", { class: "narrow" }, owner)),
    hint("Spending is what actually went out of each category (refunds net " +
      "off); assigned is what you gave it that month. Click a category to see " +
      "every transaction in it."));

  const stats = el("div", { class: "stat-grid" });
  const paceTitle = sectionTitle("This month so far");
  const paceNote = hint("");
  const paceTable = table([
    { key: "name", label: "Category" },
    { key: "spent", label: "Spent so far", className: "num" },
    { key: "usual", label: "Usual by today", className: "num" },
    { key: "projected", label: "On pace for", className: "num" },
    { key: "available", label: "Has this month", className: "num" },
    { key: "flag", label: "" },
  ]);
  const historyTitle = sectionTitle("Over the last months");
  const historyNote = hint("");
  const historyTable = table([
    { key: "name", label: "Category" },
    { key: "assigned", label: "Assigned / month", className: "num" },
    { key: "spent", label: "Spent / month", className: "num" },
    { key: "over", label: "Months over", className: "num" },
    { key: "suggest", label: "Suggestion" },
  ]);
  historyTable.classList.add("scroll-table");

  const nodes = [controls, stats, paceTitle, paceNote, paceTable, historyTitle,
    historyNote, historyTable, log];

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    const current = localMonth();
    const months = ba.fullMonthsBefore(current, Number(settings.bvaMonths || 6));
    log.clearLog();
    log.write(`Reading ${months.length} month(s) of assigned amounts...`, "head");
    const result = await app.run(async () => {
      const [details, now, { list }] = await Promise.all([
        Promise.all(months.map((m) => state.month(m))),
        state.month(current),
        state.loadAllTransactions(),
      ]);
      return { months, details: details.map((d) => d.data), now: now.data, transactions: list };
    }, { log });
    if (!result) return;
    loaded = { ...result, current };
    log.write("Done.", "ok");
    render();
  }

  function render() {
    if (!loaded) return;
    const keep = new Map(assignableCategories(state).map((c) => [c.id, c]));
    const wanted = (id) => keep.has(id) && ownerMatches(state, keep.get(id).groupName, owner.value);
    const enrich = (categories) => (categories || [])
      .filter((c) => wanted(c.id))
      .map((c) => ({ ...c, name: keep.get(c.id).name, groupName: keep.get(c.id).groupName }));

    const history = loaded.months.map((month, i) => ({ month, categories: enrich(loaded.details[i]?.categories) }));
    const spending = ba.spendingByMonth(loaded.transactions);
    const rows = ba.budgetVsActual(history, spending);
    const today = new Date();
    const paceRows = ba.pace({
      categories: enrich(loaded.now?.categories),
      transactions: loaded.transactions,
      currentMonth: loaded.current,
      day: today.getDate(),
      lookback: loaded.months.slice(-Math.min(6, loaded.months.length)),
    });

    const count = (status) => rows.filter((r) => r.status === status).length;
    clear(stats).append(
      stat("Needs more", String(count("under")), {
        kind: count("under") ? "error" : "ok", note: "Usually spends more than it gets",
      }),
      stat("Gets too much", String(count("over")), {
        kind: count("over") ? "warn" : "", note: "Not saving up, just more than it uses",
      }),
      stat("On pace to run out", String(paceRows.filter((r) => r.willRunOut).length), {
        kind: paceRows.some((r) => r.willRunOut) ? "error" : "ok", note: "This month",
      }),
      stat("Categories compared", String(rows.length), {
        note: `${loaded.months.length} full month(s)`,
      }));

    // ---- pace ----
    paceNote.textContent = "Compared with what you had usually spent by this " +
      "day in past months, so a bill that always lands early does not look " +
      "like a surprise. \"On pace for\" adds what is usually still to come.";
    clear(paceTable.tbody);
    if (!paceRows.length) {
      emptyRow(paceTable, "Nothing is running ahead of its usual pace this month.");
    }
    for (const row of paceRows) {
      paceTable.tbody.append(el("tr", {},
        el("td", {}, link(row), el("div", { class: "hint", text: row.groupName })),
        el("td", { class: "num", text: fmt(row.spentNow) }),
        el("td", { class: "num hint", text: fmt(row.typicalByNow) }),
        el("td", { class: `num ${row.willRunOut ? "is-error" : ""}`, text: fmt(row.projected) }),
        el("td", { class: "num", text: fmt(row.available) }),
        el("td", {}, row.willRunOut
          ? pill(`Short ${fmt(row.shortBy)}`, "error")
          : pill("Ahead of usual", "caution"))));
    }

    // ---- history ----
    historyTitle.textContent = `Over the last ${loaded.months.length} months`;
    historyNote.textContent = "Grouped by what each category usually does. " +
      "A suggestion is what it actually spends a month, rounded up to $5.";
    clear(historyTable.tbody);
    if (!rows.length) emptyRow(historyTable, "Nothing assigned or spent in that time.");
    for (const status of ["under", "over", "saving", "ok"]) {
      const group = rows.filter((r) => r.status === status);
      if (!group.length) continue;
      const collapsible = status === "ok";
      historyTable.tbody.append(el("tr", { class: "group-row" },
        el("td", { colspan: "5" },
          collapsible
            ? el("button", {
              type: "button", class: "group-toggle", "aria-expanded": String(showOnTrack),
              onClick: () => { showOnTrack = !showOnTrack; render(); },
            },
            el("span", { class: "caret", "aria-hidden": "true", text: "▾" }),
            el("span", { text: STATUS[status].title }),
            el("span", { class: "count", text: String(group.length) }))
            : el("span", { class: "bva-group-title" },
              `${STATUS[status].title} `, el("span", { class: "count", text: String(group.length) })))));
      if (collapsible && !showOnTrack) continue;
      for (const row of group) {
        historyTable.tbody.append(el("tr", {},
          el("td", { class: "indent" }, link(row), el("div", { class: "hint", text: row.groupName })),
          el("td", { class: "num", text: fmt(row.avgAssigned) }),
          el("td", { class: `num ${row.status === "under" ? "is-error" : ""}`, text: fmt(row.avgSpent) }),
          el("td", { class: "num", text: `${row.overMonths} of ${row.months.length}` }),
          el("td", {}, suggestion(row))));
      }
    }
  }

  function suggestion(row) {
    if (row.status === "under") {
      return el("span", {}, pill(STATUS.under.pill[0], "error"),
        ` Assign about ${fmt(row.suggested)}`);
    }
    if (row.status === "over") {
      return el("span", {}, pill(STATUS.over.pill[0], "warn"),
        ` Could be ${fmt(row.suggested)}`);
    }
    if (row.status === "saving") return pill(STATUS.saving.pill[0], "info");
    return el("span", { class: "hint", text: "" });
  }

  function link(row) {
    return categoryLink(app, { id: row.id, name: row.name }, { log });
  }

  return { nodes, show: () => (loaded ? render() : load()) };
}
