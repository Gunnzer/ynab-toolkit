// Upcoming bills: what is due in the next few weeks, and whether each
// everyday account covers it. Read only.

import { fmt } from "../money.js";
import { FREQUENCY_LABELS, forecastAccounts, upcomingEvents } from "../tools/forecast.js";
import { findRecurring } from "../tools/recurring.js";
import {
  card, clear, dateLabel, el, emptyRow, hint, logPane, pageHeading, pill,
  sectionTitle, select, table,
} from "../ui.js";
import { localToday, stat } from "./report_kit.js";

const HORIZONS = [
  { value: "14", label: "Next 2 weeks" },
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 60 days" },
];

/** Everything needed to forecast, shared with Home's dashboard. */
export async function loadForecast(state, { days = 30 } = {}) {
  const today = localToday();
  const [{ list }, scheduled] = await Promise.all([
    state.loadAllTransactions(),
    state.scheduled(),
  ]);
  const events = upcomingEvents({
    scheduled,
    recurringOut: findRecurring(list, { today }),
    recurringIn: findRecurring(list, { today, direction: "in" }),
    today,
    days,
  });
  return { today, days, events, accounts: forecastAccounts(state.accounts, events, { today }) };
}

export function upcomingPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("upcoming");

  const root = el("div", { class: "page-body" });
  const log = logPane("Reading scheduled transactions and your history.");
  let forecast = null;

  root.append(pageHeading(
    "Upcoming Bills",
    "What is due over the next few weeks and whether each everyday account " +
    "covers it. Bills come from YNAB's scheduled transactions first, then " +
    "from regular charges and income spotted in your history where nothing " +
    "is scheduled for them. Nothing here changes your budget."));

  const horizon = select(HORIZONS, settings.days || "30", (value) => {
    settings.days = value;
    store.save();
    load();
  });

  root.append(card(
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Look ahead" }),
      el("div", { class: "narrow" }, horizon)),
    hint("\"Expected\" items are spotted from your history, so the amount is " +
      "what they usually come to. A card payment only shows up if it is " +
      "scheduled in YNAB - spending on a credit card does not touch your " +
      "chequing account until you pay the card.")));

  const stats = el("div", { class: "stat-grid" });
  const accountsTable = table([
    { key: "name", label: "Account" },
    { key: "now", label: "Today", className: "num" },
    { key: "low", label: "Lowest", className: "num" },
    { key: "when", label: "When" },
    { key: "end", label: "At the end", className: "num" },
    { key: "flag", label: "" },
  ]);
  const timeline = table([
    { key: "payee", label: "What" },
    { key: "account", label: "Account" },
    { key: "how", label: "How often" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "after", label: "Account after", className: "num" },
  ]);
  timeline.classList.add("scroll-table");

  root.append(stats, sectionTitle("Accounts"), accountsTable,
    sectionTitle("Coming up"), timeline, log);

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    log.clearLog();
    const result = await app.run(() => loadForecast(state, { days: Number(settings.days || 30) }), { log });
    if (!result) return;
    forecast = result;
    state.recordRun("upcoming");
    render();
  }

  function render() {
    if (!forecast) return;
    const { events, accounts, days } = forecast;
    const bills = events.filter((e) => e.amount < 0);
    const income = events.filter((e) => e.amount > 0);
    const lowest = accounts[0] || null;
    const troubled = accounts.filter((a) => a.firstNegative);

    clear(stats).append(
      stat("Bills due", String(bills.length), {
        note: `${fmt(-bills.reduce((s, e) => s + e.amount, 0))} in the next ${days} days`,
      }),
      stat("Money coming in", fmt(income.reduce((s, e) => s + e.amount, 0)), {
        note: `${income.length} payment(s) expected`,
      }),
      stat("Lowest balance", lowest ? fmt(lowest.low) : "-", {
        kind: lowest && lowest.low < 0 ? "error" : "",
        note: lowest ? `${lowest.name}, ${dateLabel(lowest.lowDate)}` : "",
      }),
      stat("Accounts going below zero", String(troubled.length), {
        kind: troubled.length ? "error" : "ok",
      }));

    clear(accountsTable.tbody);
    if (!accounts.length) emptyRow(accountsTable, "No open chequing, savings or cash accounts.");
    for (const account of accounts) {
      accountsTable.tbody.append(el("tr", {},
        el("td", { text: account.name }),
        el("td", { class: "num", text: fmt(account.start) }),
        el("td", { class: `num ${account.low < 0 ? "is-error" : ""}`, text: fmt(account.low) }),
        el("td", { class: "hint", text: account.lowDate === forecast.today ? "Today" : dateLabel(account.lowDate) }),
        el("td", { class: "num", text: fmt(account.end) }),
        el("td", {}, account.firstNegative
          ? pill(`Below zero ${dateLabel(account.firstNegative)}`, "error")
          : pill("Covered", "ok"))));
    }

    // Balance after each event, in the account it comes out of (or goes
    // into) - cash accounts only; a card charge has none.
    const balanceAfter = new Map();
    for (const account of accounts) {
      for (const line of account.events) {
        if (line.accountId === account.id) balanceAfter.set(line.index, line.balanceAfter);
      }
    }

    clear(timeline.tbody);
    if (!events.length) {
      emptyRow(timeline, "Nothing scheduled or expected in that time.");
      return;
    }
    let lastDate = null;
    for (const event of events) {
      if (event.date !== lastDate) {
        lastDate = event.date;
        timeline.tbody.append(el("tr", { class: "group-row" },
          el("td", { colspan: "5", text: event.date === forecast.today ? "Today" : dateLabel(event.date) })));
      }
      const balance = balanceAfter.get(event.index);
      timeline.tbody.append(el("tr", {},
        el("td", {},
          el("div", { class: "history-payee" },
            el("span", { text: event.payee || "(no payee)" }),
            event.late ? pill("Due", "caution") : null),
          event.categoryId ? el("div", { class: "hint", text: state.categoryName(event.categoryId, "") }) : null),
        el("td", { class: "hint", text: state.accountName(event.accountId) }),
        el("td", {},
          el("span", { text: FREQUENCY_LABELS[event.how] || event.how || "" }),
          el("div", { class: "hint", text: event.source === "scheduled" ? "Scheduled in YNAB" : "Expected from history" })),
        el("td", {
          class: `num ${event.amount > 0 ? "is-ok" : ""}`,
          text: event.amount > 0 ? `+${fmt(event.amount)}` : fmt(event.amount),
        }),
        el("td", {
          class: `num ${balance !== undefined && balance < 0 ? "is-error" : "hint"}`,
          text: balance === undefined ? "" : fmt(balance),
        })));
    }
  }

  load();
  return root;
}
