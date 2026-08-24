// RTA Tracker: snapshots Ready to Assign over time and explains, as best it
// can, why it moved between two snapshots.

import { fmt } from "../money.js";
import * as rta from "../tools/rta_tracker.js";
import {
  button, card, clear, confirmDialog, dateLabel, el, emptyRow, hint,
  logPane, pageHeading, pill, sectionTitle, table,
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

    const result = await app.run(async () => {
      const client = state.requireClient();
      const month = rta.currentMonthString();

      const monthData = await client.month(state.budgetId, month);
      const { transactions, server_knowledge: serverKnowledge } =
        await client.transactionsDelta(state.budgetId, {
          lastKnowledgeOfServer: settings.serverKnowledge || undefined,
        });

      return rta.buildSnapshot({
        month,
        toBeBudgeted: monthData.to_be_budgeted,
        previousSnapshot: lastSnapshot(),
        deltaTransactions: transactions,
        serverKnowledge,
      });
    }, { log, buttons: [snapshotButton] });

    if (!result) return;

    snapshots().push(result);
    settings.serverKnowledge = result.serverKnowledge;
    store.save();

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
