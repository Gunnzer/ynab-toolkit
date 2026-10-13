// Reports tab: recurring charges and subscriptions.

import { fmt } from "../money.js";
import { findRecurring, recurringTotals } from "../tools/recurring.js";
import {
  card, checkbox, clear, customDialog, dateLabel, el, emptyRow, hint, logPane,
  pill, table,
} from "../ui.js";
import { localToday, stat } from "./report_kit.js";

export function recurringReport(app, { settings, store }) {
  const state = app.state;
  const log = logPane("Looking for charges that repeat.");
  let loaded = null;

  const showStopped = checkbox("Show ones that seem to have stopped", Boolean(settings.recurringShowStopped),
    (value) => {
      settings.recurringShowStopped = value;
      store.save();
      render();
    });

  const controls = card(
    el("div", { class: "card-row" },
      hint("Found by spotting the same payee charging a similar amount on a " +
        "regular schedule over the last 15 months. Click one to see every charge."),
      el("span", { class: "spacer" }),
      showStopped));

  const stats = el("div", { class: "stat-grid" });
  const list = table([
    { key: "payee", label: "Payee" },
    { key: "often", label: "How often" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "year", label: "Per year", className: "num" },
    { key: "last", label: "Last charged" },
    { key: "next", label: "Next expected" },
    { key: "flags", label: "" },
  ]);
  list.classList.add("scroll-table");

  const nodes = [controls, stats, list, log];

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    const result = await app.run(() => state.loadAllTransactions(), { log });
    if (!result) return;
    loaded = { transactions: result.list, found: findRecurring(result.list, { today: localToday() }) };
    log.clearLog();
    render();
  }

  function render() {
    if (!loaded) return;
    const found = loaded.found;
    const active = found.filter((r) => !r.stopped);
    const totals = recurringTotals(found);
    const raised = active.filter((r) => r.priceUp);
    const fresh = active.filter((r) => r.isNew);

    clear(stats).append(
      stat("Recurring", String(active.length), { note: "Still going" }),
      stat("Per month", fmt(totals.monthly), { note: "Everything still going, averaged" }),
      stat("Per year", fmt(totals.yearly)),
      stat("Price went up", String(raised.length), {
        kind: raised.length ? "warn" : "",
        note: raised.length ? raised.map((r) => r.payee).slice(0, 3).join(", ") : "None",
      }),
      stat("New", String(fresh.length), {
        note: fresh.length ? fresh.map((r) => r.payee).slice(0, 3).join(", ") : "None lately",
      }));

    const shown = showStopped.querySelector("input").checked ? found : active;
    clear(list.tbody);
    if (!shown.length) {
      emptyRow(list, "No regular charges found.");
      return;
    }
    let stoppedHeader = false;
    for (const item of shown) {
      if (item.stopped && !stoppedHeader) {
        stoppedHeader = true;
        list.tbody.append(el("tr", { class: "group-row" },
          el("td", { colspan: "7", text: "Seem to have stopped - not counted in the totals" })));
      }
      const flags = [];
      if (item.priceUp) flags.push(pill(`Up ${fmt(item.priceUp.to - item.priceUp.from)}`, "warn"));
      if (item.isNew) flags.push(pill("New", "info"));
      if (item.stopped) flags.push(pill("Stopped?", "muted"));

      list.tbody.append(el("tr", { class: item.stopped ? "is-faded" : "" },
        el("td", {},
          el("button", {
            type: "button", class: "category-link", text: item.payee || "(no payee)",
            title: "See every charge", onClick: () => showCharges(item),
          }),
          el("div", { class: "hint", text: item.categoryId ? state.categoryName(item.categoryId, "") : "" })),
        el("td", { text: item.cadenceLabel }),
        el("td", { class: "num" },
          item.varies
            ? el("span", { title: `Latest ${fmt(item.latest)}` }, `about ${fmt(item.typical)}`)
            : fmt(item.latest)),
        el("td", { class: "num", text: fmt(item.yearly) }),
        el("td", { text: dateLabel(item.lastDate) }),
        el("td", { class: item.stopped ? "hint" : "", text: dateLabel(item.nextDate) }),
        el("td", {}, ...flags)));
    }
  }

  function showCharges(item) {
    const byId = new Map(loaded.transactions.map((t) => [t.id, t]));
    customDialog(item.payee || "(no payee)", (body) => {
      body.append(hint(`${item.cadenceLabel}, ${item.count} charge(s) since ` +
        `${dateLabel(item.firstDate)}. About ${fmt(item.yearly)} a year.`));
      const charges = table([
        { key: "date", label: "Date" },
        { key: "account", label: "Account" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      charges.classList.add("scroll-table", "history-table");
      for (const id of [...item.transactionIds].reverse()) {
        const t = byId.get(id);
        if (!t) continue;
        charges.tbody.append(el("tr", {},
          el("td", { text: dateLabel(t.date) }),
          el("td", { class: "hint", text: t.account_name || "" }),
          el("td", { class: "num", text: fmt(t.amount) })));
      }
      body.append(charges);
      return { value: () => true };
    }, { confirmText: "Close", cancelText: "", hideCancel: true });
  }

  return { nodes, show: () => (loaded ? render() : load()) };
}
