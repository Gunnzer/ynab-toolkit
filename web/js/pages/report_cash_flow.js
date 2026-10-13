// Reports tab: income against spending, and the savings rate.

import { fmt } from "../money.js";
import { fullMonthsBefore } from "../tools/budget_actual.js";
import { cashFlow, cashFlowTotals } from "../tools/cash_flow.js";
import { readyToAssignCategoryIds } from "../tools/rta_tracker.js";
import { card, clear, el, emptyRow, hint, logPane, monthLabel, table } from "../ui.js";
import { localMonth, percentText, stat } from "./report_kit.js";

export function cashFlowReport(app) {
  const state = app.state;
  const log = logPane("Reading income and spending.");
  let loaded = null;

  const intro = card(hint(
    "Income is what reached Ready to Assign. Spending is everything that " +
    "went out of a category, refunds netting off. Money moved to an " +
    "investment or other tracking account counts as saved, not spent. " +
    "Savings rate is what was left over as a share of income."));
  const stats = el("div", { class: "stat-grid" });
  const list = table([
    { key: "month", label: "Month" },
    { key: "bars", label: "" },
    { key: "income", label: "Income", className: "num" },
    { key: "spending", label: "Spending", className: "num" },
    { key: "left", label: "Left over", className: "num" },
    { key: "rate", label: "Savings rate", className: "num" },
  ]);
  list.classList.add("scroll-table", "cash-flow-table");
  const legend = el("div", { class: "card-row cash-flow-legend" },
    el("span", {}, el("span", { class: "swatch is-income" }), " Income"),
    el("span", {}, el("span", { class: "swatch is-spending" }), " Spending"));

  const nodes = [intro, stats, legend, list, log];

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    const result = await app.run(() => state.loadAllTransactions(), { log });
    if (!result) return;
    loaded = { transactions: result.list };
    log.clearLog();
    render();
  }

  function render() {
    if (!loaded) return;
    const current = localMonth();
    const full = fullMonthsBefore(current, 12);
    const rows = cashFlow({
      transactions: loaded.transactions,
      rtaIds: readyToAssignCategoryIds(state.categoryGroups),
      months: [...full, current],
    });
    const fullRows = rows.slice(0, -1);
    const totals = cashFlowTotals(fullRows);

    clear(stats).append(
      stat("Income", fmt(totals.income), { note: "Last 12 full months" }),
      stat("Spending", fmt(totals.spending), { note: `${fmt(totals.averageSpending)} a month on average` }),
      stat("Left over", fmt(totals.leftOver), {
        kind: totals.leftOver < 0 ? "error" : "ok",
        note: totals.toTracking ? `Includes ${fmt(totals.toTracking)} moved to investments` : "",
      }),
      stat("Savings rate", totals.rate === null ? "-" : percentText(totals.rate).replace("+", ""), {
        kind: totals.rate === null ? "" : totals.rate < 0 ? "error" : totals.rate >= 0.1 ? "ok" : "warn",
        note: "Left over as a share of income",
      }));

    clear(list.tbody);
    if (!rows.some((r) => r.income || r.spending)) {
      emptyRow(list, "No income or spending in the last year.");
      return;
    }
    const scale = Math.max(1, ...rows.map((r) => Math.max(r.income, r.spending)));
    for (const row of [...rows].reverse()) {
      const isCurrent = row.month === current;
      list.tbody.append(el("tr", { class: isCurrent ? "is-current" : "" },
        el("td", {},
          el("div", { text: monthLabel(row.month) }),
          isCurrent ? el("div", { class: "hint", text: "So far" }) : null),
        el("td", { class: "cash-flow-bars" },
          bar(row.income, scale, "is-income"),
          bar(row.spending, scale, "is-spending")),
        el("td", { class: "num", text: fmt(row.income) }),
        el("td", { class: "num", text: fmt(row.spending) }),
        el("td", { class: `num ${row.leftOver < 0 ? "is-error" : "is-ok"}`, text: fmt(row.leftOver) }),
        el("td", { class: "num", text: row.rate === null ? "-" : percentText(row.rate).replace("+", "") })));
    }
    list.tbody.append(el("tr", { class: "total-row" },
      el("td", { text: "Average month" }),
      el("td", {}),
      el("td", { class: "num", text: fmt(Math.round(totals.income / fullRows.length)) }),
      el("td", { class: "num", text: fmt(totals.averageSpending) }),
      el("td", { class: "num", text: fmt(Math.round(totals.leftOver / fullRows.length)) }),
      el("td", { class: "num", text: totals.rate === null ? "-" : percentText(totals.rate).replace("+", "") })));
  }

  function bar(value, scale, kind) {
    return el("div", { class: `cash-bar ${kind}` },
      el("span", { style: `width:${Math.max(0, Math.round((value / scale) * 100))}%` }));
  }

  return { nodes, show: () => (loaded ? render() : load()) };
}
