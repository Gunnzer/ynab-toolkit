// Reports tab: each category's spending over the last 12 months, and which
// ones have moved most against their own usual.

import { fmt } from "../money.js";
import { fullMonthsBefore, spendingByMonth } from "../tools/budget_actual.js";
import { categoryTrends } from "../tools/trends.js";
import {
  card, checkbox, clear, el, emptyRow, hint, logPane, monthLabel, pill, table,
} from "../ui.js";
import { categoryLink } from "./category_history_dialog.js";
import {
  assignableCategories, localMonth, ownerMatches, ownerSelect, percentText, sparkline,
} from "./report_kit.js";

export function trendsReport(app, { settings, store }) {
  const state = app.state;
  const log = logPane("Reading your spending history.");
  let loaded = null;

  const owner = ownerSelect(state, settings.insightOwner, (value) => {
    settings.insightOwner = value;
    store.save();
    render();
  });
  const moversOnly = checkbox("Only the biggest changes", settings.trendsMoversOnly !== false,
    (value) => {
      settings.trendsMoversOnly = value;
      store.save();
      render();
    });

  const controls = card(
    el("div", { class: "card-row" },
      el("span", { class: "field-label", style: "margin:0", text: "Whose" }),
      el("div", { class: "narrow" }, owner),
      el("span", { class: "spacer" }),
      moversOnly),
    hint("Each bar is one full month, oldest on the left. \"Change\" is the " +
      "last 3 months against the 9 before them, so it shows a real shift, " +
      "not one odd month. Click a category to see every transaction in it."));

  const summary = hint("");
  const list = table([
    { key: "name", label: "Category" },
    { key: "trend", label: "Last 12 months" },
    { key: "usual", label: "Usual / month", className: "num" },
    { key: "recent", label: "Last 3 / month", className: "num" },
    { key: "change", label: "Change", className: "num" },
    { key: "now", label: "This month so far", className: "num" },
  ]);
  list.classList.add("scroll-table", "trends-table");

  const nodes = [controls, summary, list, log];

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    const result = await app.run(() => state.loadAllTransactions(), { log });
    if (!result) return;
    loaded = { spending: spendingByMonth(result.list) };
    log.clearLog();
    render();
  }

  function render() {
    if (!loaded) return;
    const current = localMonth();
    const months = fullMonthsBefore(current, 12);
    const categories = assignableCategories(state)
      .filter((c) => ownerMatches(state, c.groupName, owner.value));
    const rows = categoryTrends({ spending: loaded.spending, months, categories, currentMonth: current });
    const shown = moversOnly.querySelector("input").checked ? rows.filter((r) => r.mover) : rows;
    const up = rows.filter((r) => r.mover && r.change > 0).length;
    const down = rows.filter((r) => r.mover && r.change < 0).length;

    summary.textContent = `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}. ` +
      `${up} categor(ies) spending noticeably more than usual, ${down} noticeably less.`;

    clear(list.tbody);
    if (!shown.length) {
      emptyRow(list, rows.length
        ? "No category has moved much against its usual - untick \"Only the biggest changes\" to see them all."
        : "No spending in that time.");
      return;
    }
    for (const row of shown) {
      const rising = row.change > 0;
      list.tbody.append(el("tr", {},
        el("td", {},
          categoryLink(app, { id: row.id, name: row.name }, { log }),
          el("div", { class: "hint", text: row.groupName })),
        el("td", {}, sparkline(row.series, {
          label: `${row.name}, monthly spending: ${row.series.map((v) => fmt(v)).join(", ")}`,
        })),
        el("td", { class: "num", text: fmt(row.usualAvg) }),
        el("td", { class: "num", text: fmt(row.recentAvg) }),
        el("td", { class: "num" },
          row.mover
            ? pill(`${rising ? "+" : "-"}${fmt(Math.abs(row.change))} (${percentText(row.changePct)})`,
              rising ? "error" : "ok")
            : el("span", { class: "hint", text: percentText(row.changePct) })),
        el("td", { class: "num hint", text: fmt(row.thisMonth) })));
    }
  }

  return { nodes, show: () => (loaded ? render() : load()) };
}
