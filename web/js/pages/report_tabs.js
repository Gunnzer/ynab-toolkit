// The Reports page's tabs. The original spending/saving report stays
// exactly as it was and becomes the first tab; each other tab is built
// once, loads its data the first time it is opened, and only re-renders
// after that.
//
// Every tab's nodes are appended straight into the page body (not wrapped
// in a container) and hidden or shown together, so the page's
// sibling-based spacing rules keep working unchanged.

import { el } from "../ui.js";
import { budgetActualReport } from "./report_budget_actual.js";
import { cashFlowReport } from "./report_cash_flow.js";
import { recurringReport } from "./report_recurring.js";
import { trendsReport } from "./report_trends.js";

export function mountReportTabs(app, root, { spendingNodes, settings, store }) {
  const context = { settings, store };
  const tabs = [
    { key: "spending", label: "Spending & saving", pane: { nodes: spendingNodes, show: () => {} } },
    { key: "budget", label: "Budget vs actual", build: () => budgetActualReport(app, context) },
    { key: "trends", label: "Trends", build: () => trendsReport(app, context) },
    { key: "recurring", label: "Recurring", build: () => recurringReport(app, context) },
    { key: "cashflow", label: "Cash flow", build: () => cashFlowReport(app, context) },
  ];

  const bar = el("div", { class: "tab-bar", role: "tablist", "aria-label": "Reports" });
  for (const tab of tabs) {
    tab.button = el("button", {
      type: "button", class: "tab", role: "tab", text: tab.label,
      onClick: () => select(tab.key),
    });
    bar.append(tab.button);
  }
  root.insertBefore(bar, root.children[1] || null);

  function select(key) {
    const target = tabs.find((t) => t.key === key) || tabs[0];
    if (!target.pane) {
      target.pane = target.build();
      root.append(...target.pane.nodes);
    }
    for (const tab of tabs) {
      const active = tab === target;
      tab.button.classList.toggle("is-active", active);
      tab.button.setAttribute("aria-selected", String(active));
      for (const node of tab.pane?.nodes || []) node.hidden = !active;
    }
    settings.reportTab = target.key;
    store.save();
    target.pane.show();
  }

  select(settings.reportTab || "spending");
}
