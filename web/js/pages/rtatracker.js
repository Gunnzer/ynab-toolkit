// RTA Tracker: snapshots Ready to Assign over time and explains, as best it
// can, why it moved between two snapshots.

import { fmt } from "../money.js";
import * as rta from "../tools/rta_tracker.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, dateLabel,
  download, el, emptyRow, hint, logPane, monthLabel, pageHeading, pill,
  sectionTitle, table,
} from "../ui.js";

const LOG_EMPTY =
  "Press \"Snapshot now\" to record today's Ready to Assign figure and see " +
  "what changed since the last one you took.";

export function rtaTrackerPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("rtaTracker");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  root.append(pageHeading(
    "RTA Tracker",
    "Ready to Assign is not scoped to the current month - it is a running " +
    "total carried forward since the budget started, so a backdated " +
    "paycheque can shift it without showing up in this month's own " +
    "activity. This records a snapshot each time you run it and tries to " +
    "explain what moved since the last one."));

  function snapshots() {
    return settings.snapshots || (settings.snapshots = []);
  }

  function lastSnapshot() {
    const list = snapshots();
    return list.length ? list[list.length - 1] : null;
  }

  // ---------- actions ----------

  const snapshotButton = button("Snapshot now", { accent: true, onClick: takeSnapshot });
  const clearLink = button("Clear history", { small: true, onClick: clearHistory });
  clearLink.classList.add("btn-link");

  root.append(card(
    el("div", { class: "card-row" }, snapshotButton, clearLink)));

  // ---------- latest result ----------

  const latestCard = card(hint(
    "Nothing recorded yet. Take a snapshot to get started."));
  root.append(latestCard);

  function renderLatest(snapshot) {
    clear(latestCard);
    if (!snapshot) {
      latestCard.append(hint("Nothing recorded yet. Take a snapshot to get started."));
      return;
    }

    const deltaPill = snapshot.delta === null
      ? pill("First snapshot", "muted")
      : pill(
        `${snapshot.delta >= 0 ? "+" : ""}${fmt(snapshot.delta)}`,
        snapshot.delta === 0 ? "muted" : snapshot.delta > 0 ? "ok" : "warn");

    latestCard.append(
      el("div", { class: "card-row" },
        sectionTitle("Latest snapshot"),
        el("span", { class: "spacer" }),
        deltaPill),
      el("p", {},
        el("b", { text: fmt(snapshot.toBeBudgeted) }),
        ` ready to assign, as of ${new Date(snapshot.timestamp).toLocaleString()}.`),
      hint(snapshot.summary));

    if (snapshot.flagged.length) {
      const flaggedTable = table([
        { key: "date", label: "Date" },
        { key: "payee", label: "Payee" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      flaggedTable.classList.add("scroll-table");
      for (const item of snapshot.flagged) {
        flaggedTable.tbody.append(el("tr", {},
          el("td", { text: dateLabel(item.date) }),
          el("td", { text: item.payee }),
          el("td", { class: "num", text: fmt(item.amount) })));
      }
      latestCard.append(flaggedTable);
    }
  }

  // ---------- reconstruction ----------
  //
  // Not persisted: it is rebuilt from YNAB's own month figures each time,
  // so there is nothing here that could drift out of date with the budget.

  let rebuilt = null;
  let problemsOnly = false;

  const rebuildButton = button("Rebuild from history", { onClick: rebuild });
  const csvButton = button("Save CSV", { small: true, onClick: saveCsv });
  csvButton.disabled = true;
  const problemsToggle = checkbox("Only months with something to check", false, (value) => {
    problemsOnly = value;
    renderReconstruction();
  });

  const reconStats = el("div", { class: "stat-grid" });
  const reconNote = hint(
    "Rebuilds Ready to Assign month by month from income and assigned " +
    "amounts, checks it against YNAB's own figure, and finds the month it " +
    "went negative.");
  const findingsCard = card();
  findingsCard.hidden = true;
  let reconTable = buildReconTable(false);
  const reconTableSlot = el("div", {}, reconTable);

  root.append(
    sectionTitle("Reconstruction"),
    card(
      el("div", { class: "card-row" }, rebuildButton, csvButton,
        el("span", { class: "spacer" }), problemsToggle),
      reconNote),
    reconStats,
    findingsCard,
    reconTableSlot);
  emptyRow(reconTable, "Press \"Rebuild from history\" to start.");

  function buildReconTable(showLater) {
    const columns = [
      { key: "month", label: "Month" },
      { key: "income", label: "Income", className: "num" },
      { key: "assigned", label: "Assigned", className: "num" },
    ];
    if (showLater) columns.push({ key: "later", label: "Assigned later", className: "num" });
    columns.push(
      { key: "other", label: "Other", className: "num" },
      { key: "ynab", label: "Ready to Assign", className: "num" },
      { key: "change", label: "Change", className: "num" },
      { key: "status", label: "Check" },
      { key: "details", label: "" });
    const wrap = table(columns);
    wrap.classList.add("scroll-table");
    return wrap;
  }

  function stat(label, value, { kind = "", note = "" } = {}) {
    return el("div", { class: "stat" },
      el("span", { class: "stat-label", text: label }),
      el("span", { class: `stat-value ${kind ? `is-${kind}` : ""}`, text: value }),
      note ? el("span", { class: "stat-note", text: note }) : null);
  }

  function signed(milli) {
    return `${milli > 0 ? "+" : ""}${fmt(milli)}`;
  }

  function rowHasProblem(row) {
    return row.negative || !row.incomeMatches || Math.abs(row.other) >= 10 ||
      row.uncategorizedCount > 0;
  }

  function renderReconstruction() {
    if (!rebuilt) return;
    const thisMonth = rta.currentMonthString();
    const pastRows = rebuilt.rows.filter((row) => row.month <= thisMonth);
    const now = pastRows[pastRows.length - 1] || null;
    const firstSnapshot = rta.firstNegativeSnapshot(snapshots());

    clear(reconStats).append(
      stat("Ready to Assign now", now ? fmt(now.ynab) : "-",
        { kind: now?.negative ? "error" : "", note: now ? monthLabel(now.month) : "" }),
      stat("First went negative",
        rebuilt.firstNegative ? monthLabel(rebuilt.firstNegative.month) : "Never",
        {
          kind: rebuilt.firstNegative ? "warn" : "ok",
          note: firstSnapshot
            ? `First snapshot showing it negative: ` +
              `${new Date(firstSnapshot.timestamp).toLocaleString()}`
            : "",
        }),
      stat("Lowest point", rebuilt.lowest ? fmt(rebuilt.lowest.ynab) : "-",
        { note: rebuilt.lowest ? monthLabel(rebuilt.lowest.month) : "" }),
      stat("Negative stretches", String(rebuilt.stretches.length), {
        note: rebuilt.stretches.map((s) =>
          s.from === s.to ? monthLabel(s.from) : `${monthLabel(s.from)} to ` +
            (s.ongoing ? "now" : monthLabel(s.to))).join(", "),
      }));

    reconNote.textContent = rebuilt.deductsLater
      ? "Rebuilt as: income so far, minus assigned so far, minus anything " +
        "already assigned in a later month (this budget's figures match " +
        "that model). \"Other\" is whatever is left that YNAB counted but " +
        "this cannot see - usually cash overspending taken from the next " +
        "month's Ready to Assign."
      : "Rebuilt as: income so far, minus assigned so far. \"Other\" is " +
        "whatever is left that YNAB counted but this cannot see - usually " +
        "cash overspending taken from the next month's Ready to Assign.";

    clear(findingsCard);
    findingsCard.hidden = !rebuilt.findings.length;
    if (rebuilt.findings.length) {
      findingsCard.append(sectionTitle(`Audit (${rebuilt.findings.length})`));
      const kinds = {
        negative: ["Went negative", "error"],
        income: ["Income mismatch", "warn"],
        other: ["Other", "caution"],
        uncategorized: ["Uncategorized", "info"],
      };
      const list = el("div", { class: "rta-findings" });
      for (const finding of [...rebuilt.findings].reverse()) {
        const [label, kind] = kinds[finding.kind];
        list.append(el("div", { class: "rta-finding" },
          el("span", { class: "rta-finding-month", text: monthLabel(finding.month) }),
          pill(label, kind),
          el("span", { text: finding.text })));
      }
      findingsCard.append(list);
    }

    const fresh = buildReconTable(rebuilt.deductsLater);
    reconTableSlot.replaceChildren(fresh);
    reconTable = fresh;

    const rows = [...rebuilt.rows].reverse()
      .filter((row) => !problemsOnly || rowHasProblem(row));
    if (!rows.length) {
      emptyRow(reconTable, problemsOnly ? "Nothing to check." : "No months found.");
      return;
    }

    for (const row of rows) {
      const status = row.wentNegative ? pill("Went negative", "error")
        : row.recovered ? pill("Recovered", "ok")
        : row.negative ? pill("Negative", "warn")
        : !row.incomeMatches ? pill("Income mismatch", "warn")
        : row.month > thisMonth ? pill("Future", "muted")
        : pill("OK", "muted");
      const cells = [
        el("td", { text: monthLabel(row.month) }),
        el("td", { class: "num", text: fmt(row.income) }),
        el("td", { class: "num", text: fmt(row.assigned) }),
      ];
      if (rebuilt.deductsLater) {
        cells.push(el("td", { class: "num", text: fmt(row.assignedLater) }));
      }
      cells.push(
        el("td", { class: "num", text: row.other ? signed(row.other) : "-" }),
        el("td", { class: `num ${row.negative ? "is-error" : ""}`, text: fmt(row.ynab) }),
        el("td", { class: "num", text: row.change === null ? "-" : signed(row.change) }),
        el("td", {}, status),
        el("td", {}, (() => {
          const link = button("Details", { small: true, onClick: () => showMonth(row) });
          link.classList.add("btn-link");
          return link;
        })()));
      reconTable.tbody.append(el("tr", {}, ...cells));
    }
  }

  function showMonth(row) {
    const inflows = rebuilt.inflows.filter((i) => rta.monthKey(i.date) === row.month);
    const uncategorized = rebuilt.uncategorized
      .filter((t) => rta.monthKey(t.date) === row.month);
    const previous = rebuilt.rows[rebuilt.rows.indexOf(row) - 1];

    customDialog(monthLabel(row.month), (body) => {
      const lines = [
        ["Left over from last month", previous ? fmt(previous.ynab) : "-"],
        ["Income (YNAB)", fmt(row.income)],
        ["Income (from transactions)", fmt(row.transactionIncome)],
        ["Assigned this month", fmt(-row.assigned)],
      ];
      if (rebuilt.deductsLater) lines.push(["Assigned in later months", fmt(-row.assignedLater)]);
      lines.push(
        ["Other (overspending, etc.)", row.other ? signed(row.other) : "-"],
        ["Ready to Assign (YNAB)", fmt(row.ynab)]);
      const breakdown = table([
        { key: "what", label: "Breakdown" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      for (const [what, amount] of lines) {
        breakdown.tbody.append(el("tr", {},
          el("td", { text: what }), el("td", { class: "num", text: amount })));
      }
      body.append(breakdown);

      body.append(sectionTitle(`Income to Ready to Assign (${inflows.length})`));
      const incomeTable = table([
        { key: "date", label: "Date" },
        { key: "payee", label: "Payee" },
        { key: "account", label: "Account" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      if (!inflows.length) emptyRow(incomeTable, "No income this month.");
      for (const item of inflows) {
        incomeTable.tbody.append(el("tr", {},
          el("td", { text: dateLabel(item.date) }),
          el("td", { text: item.payee + (item.splitLeg ? " (split)" : "") }),
          el("td", { text: state.accountName(item.accountId) }),
          el("td", { class: "num", text: fmt(item.amount) })));
      }
      body.append(incomeTable);

      if (uncategorized.length) {
        body.append(
          sectionTitle(`Uncategorized (${uncategorized.length})`),
          hint("Not counted in Ready to Assign until categorized."));
        const uncatTable = table([
          { key: "date", label: "Date" },
          { key: "payee", label: "Payee" },
          { key: "account", label: "Account" },
          { key: "amount", label: "Amount", className: "num" },
        ]);
        for (const t of uncategorized) {
          uncatTable.tbody.append(el("tr", {},
            el("td", { text: dateLabel(t.date) }),
            el("td", { text: t.payee_name || "(no payee)" }),
            el("td", { text: state.accountName(t.account_id) }),
            el("td", { class: "num", text: fmt(t.amount) })));
        }
        body.append(uncatTable);
      }
      return { value: () => true };
    }, { confirmText: "Done", cancelText: "", hideCancel: true, wide: true });
  }

  async function rebuild() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }

    log.clearLog();
    log.write("Rebuilding Ready to Assign from history...", "head");

    const result = await app.run(async () => {
      const [months, { list }] = await Promise.all([
        state.requireClient().months(state.budgetId),
        state.loadAllTransactions(),
      ]);
      return rta.reconstruct({
        months,
        transactions: list,
        rtaIds: rta.readyToAssignCategoryIds(state.categoryGroups),
      });
    }, { log, buttons: [rebuildButton] });

    if (!result) return;
    rebuilt = result;
    csvButton.disabled = false;
    renderReconstruction();
    log.write(
      rebuilt.firstNegative
        ? `First went negative in ${monthLabel(rebuilt.firstNegative.month)}.`
        : "Ready to Assign never went negative in any month.",
      rebuilt.firstNegative ? "error" : "ok");
    log.write(`${rebuilt.findings.length} audit finding(s).`, "muted");
  }

  function saveCsv() {
    if (!rebuilt) return;
    download(`ready-to-assign-${rta.currentMonthString()}.csv`,
      rta.reconstructionCsv(rebuilt.rows), "text/csv");
  }

  // ---------- history ----------

  const historyTable = table([
    { key: "when", label: "Taken" },
    { key: "month", label: "Month" },
    { key: "rta", label: "Ready to Assign", className: "num" },
    { key: "delta", label: "Change", className: "num" },
    { key: "flagged", label: "Flagged" },
  ]);
  historyTable.classList.add("scroll-table");

  root.append(sectionTitle("History"), historyTable, log);

  function renderHistory() {
    const list = snapshots();
    clear(historyTable.tbody);
    if (!list.length) {
      emptyRow(historyTable, "No snapshots yet.");
      return;
    }
    for (const snapshot of [...list].reverse()) {
      historyTable.tbody.append(el("tr", {},
        el("td", { text: new Date(snapshot.timestamp).toLocaleString() }),
        el("td", { text: snapshot.month }),
        el("td", { class: "num", text: fmt(snapshot.toBeBudgeted) }),
        el("td", {
          class: "num",
          text: snapshot.delta === null
            ? "-" : `${snapshot.delta >= 0 ? "+" : ""}${fmt(snapshot.delta)}`,
        }),
        el("td", { text: snapshot.flagged.length ? String(snapshot.flagged.length) : "-" })));
    }
  }

  // ---------- run ----------

  async function takeSnapshot() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }

    log.clearLog();
    log.write("Taking a snapshot...", "head");

    // Same snapshotRta() a plain budget refresh runs on its own - calling
    // it here too instead of duplicating the fetch means there is only one
    // place that decides what a snapshot actually contains.
    const result = await app.run(() => state.snapshotRta(),
      { log, buttons: [snapshotButton] });

    if (!result) return;

    renderLatest(result);
    renderHistory();
    log.write(result.summary, result.delta ? "ok" : "muted");
    state.recordRun("rtaTracker");
  }

  async function clearHistory() {
    if (!snapshots().length) return;
    const confirmed = await confirmDialog("Clear history",
      `Remove all ${snapshots().length} recorded snapshot(s)? The next ` +
      "snapshot will start fresh, reading every transaction again to " +
      "build its own delta baseline.", { confirmText: "Clear" });
    if (!confirmed) return;

    settings.snapshots = [];
    settings.serverKnowledge = null;
    store.save();
    renderLatest(null);
    renderHistory();
    log.write("History cleared.", "muted");
  }

  // ---------- first paint ----------

  renderLatest(lastSnapshot());
  renderHistory();

  return root;
}
