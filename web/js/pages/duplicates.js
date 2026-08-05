// Duplicates: find transactions that look imported twice, and flag them.

import { fmt } from "../money.js";
import * as duplicates from "../tools/duplicates.js";
import {
  button, card, checkbox, clear, confirmDialog, el, emptyRow, field, hint,
  logPane, monthsAgoIso, pageHeading, select, table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing scanned yet. This tool never deletes anything: the most it does " +
  "is set a flag colour, which you can clear in YNAB with one click.";

export function duplicatesPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("duplicates");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);
  let groups = [];
  const boxes = new Map();

  root.append(pageHeading(
    "Duplicates",
    "Finds transactions with the same amount and payee a few days apart, " +
    "which is what a bank export imported twice looks like. Review them, " +
    "then flag the ones you want to deal with in YNAB."));

  // ---------- settings ----------

  if (!settings.since) settings.since = monthsAgoIso(3);

  const sinceInput = textInput(settings.since, {
    type: "date",
    onInput: (value) => { settings.since = value; store.save(); },
  });

  const withinInput = textInput(String(settings.withinDays ?? 3), {
    type: "number",
    onInput: (value) => {
      const days = Number.parseInt(value, 10);
      settings.withinDays = Number.isFinite(days) ? Math.max(0, days) : 3;
      store.save();
    },
  });
  withinInput.min = "0";
  withinInput.max = "30";

  const colourSelect = select(
    duplicates.FLAG_COLOURS.map((colour) => ({
      value: colour,
      label: colour[0].toUpperCase() + colour.slice(1),
    })),
    settings.flagColour || "red",
    (value) => { settings.flagColour = value; store.save(); });

  root.append(card(
    el("div", { class: "card-grid" },
      field("Look at transactions since", sinceInput),
      field("Days either side", withinInput),
      field("Flag colour", colourSelect)),
    checkbox("Only match within the same account", settings.sameAccount,
      (checked) => { settings.sameAccount = checked; store.save(); }),
    checkbox("Ignore transfers between your own accounts",
      settings.ignoreTransfers !== false,
      (checked) => { settings.ignoreTransfers = checked; store.save(); }),
    hint("A shorter date window and a smaller day gap mean fewer false " +
      "matches. Regular subscriptions a month apart are never reported.")));

  // ---------- actions ----------

  const scanButton = button("Scan for duplicates", { accent: true, onClick: scan });
  const flagButton = button("Flag selected", { onClick: flagSelected });
  const allButton = button("Select all", { small: true, onClick: () => setAll(true) });
  const noneButton = button("Select none", { small: true, onClick: () => setAll(false) });
  const summary = hint("");

  root.append(el("div", { class: "card-row" },
    scanButton, flagButton, allButton, noneButton, summary));

  const results = table([
    { key: "check", label: "", className: "check" },
    { key: "date", label: "Date" },
    { key: "payee", label: "Payee" },
    { key: "account", label: "Account" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "note", label: "" },
  ]);

  root.append(results, log);

  function setAll(checked) {
    for (const box of boxes.values()) box.checked = checked;
    paintSummary();
  }

  function selected() {
    return [...boxes.entries()]
      .filter(([, box]) => box.checked)
      .map(([id]) => id);
  }

  function paintSummary() {
    const count = selected().length;
    const total = boxes.size;
    summary.textContent = total
      ? `${count} of ${total} suspect transaction(s) selected.`
      : "";
    flagButton.disabled = count === 0;
    // Nothing to select until a scan has found something.
    allButton.disabled = total === 0;
    noneButton.disabled = total === 0;
  }

  function showGroups(found) {
    groups = found;
    boxes.clear();
    clear(results.tbody);

    if (!found.length) {
      emptyRow(results, "No likely duplicates found in that period.");
      paintSummary();
      return;
    }

    for (const group of found) {
      results.tbody.append(el("tr", { class: "group-row" },
        el("td", { colspan: String(results.columns.length) },
          `${group.payee || "(no payee)"}   ${fmt(group.amount)}   ` +
          `${group.transactions.length} transactions ` +
          `over ${group.spanDays} day(s)`)));

      group.transactions.forEach((transaction, index) => {
        // The first of a run is treated as the original; the rest are the
        // suspects, so those are what gets ticked by default.
        const isExtra = index > 0;
        const box = el("input", { type: "checkbox" });
        box.checked = isExtra;
        box.addEventListener("change", paintSummary);
        boxes.set(transaction.id, box);

        results.tbody.append(el("tr", {},
          el("td", { class: "check" }, box),
          el("td", { text: transaction.date }),
          el("td", { text: transaction.payee_name || "(no payee)" }),
          el("td", { text: state.accountName(transaction.account_id) || "" }),
          el("td", { class: "num", text: fmt(transaction.amount) }),
          el("td", {
            class: "hint",
            text: isExtra ? "possible duplicate" : "first seen",
          })));
      });
    }
    paintSummary();
  }

  async function scan() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }
    if (!sinceInput.value) return log.write("Pick a start date first.", "error");

    log.clearLog();
    log.write(`Reading transactions since ${sinceInput.value} ...`, "head");

    const found = await app.run(async () => {
      const fetched = await state.transactions(sinceInput.value);
      const transactions = fetched.list;
      log.write(`${transactions.length} transaction(s) read` +
        (fetched.cached ? ` (already loaded ${state.dataAge()}).` : "."));
      return duplicates.find(transactions, {
        withinDays: settings.withinDays ?? 3,
        ignoreTransfers: settings.ignoreTransfers !== false,
        requireSameAccount: Boolean(settings.sameAccount),
      });
    }, { log, buttons: [scanButton] });

    if (!found) return;

    const suspects = found.reduce((sum, group) => sum + group.extras.length, 0);
    log.write(found.length
      ? `${found.length} group(s) found, ${suspects} possible duplicate(s). ` +
        "Nothing has been changed."
      : "No likely duplicates found.", found.length ? "ok" : "muted");
    showGroups(found);
  }

  async function flagSelected() {
    const ids = selected();
    if (!ids.length) return;

    const colour = settings.flagColour || "red";
    const confirmed = await confirmDialog("Flag transactions",
      `Set the ${colour} flag on ${ids.length} transaction(s) in ` +
      `'${state.budgetName}'?\n\nNothing is deleted. Clearing a flag in YNAB ` +
      "undoes this.", { confirmText: "Flag them" });
    if (!confirmed) return;

    const lookup = new Map();
    for (const group of groups) {
      for (const transaction of group.transactions) lookup.set(transaction.id, transaction);
    }
    const chosen = ids.map((id) => lookup.get(id)).filter(Boolean);

    log.clearLog();
    log.write(`Flagging ${chosen.length} transaction(s) ...`, "head");

    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();
      return duplicates.flagTransactions(client, state.budgetId, chosen, colour, {
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [scanButton, flagButton] });

    if (!result) return;
    state.invalidate();
    log.write(`Flagged ${result.flagged} transaction(s).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
    if (result.flagged) state.recordRun("duplicates");
  }

  // ---------- first paint ----------

  emptyRow(results, "Run a scan to see possible duplicates.");
  paintSummary();

  return root;
}
