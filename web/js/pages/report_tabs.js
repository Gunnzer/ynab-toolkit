// The Reports page's tabs. The original spending/saving report stays
// exactly as it was and becomes the first tab; each other tab is built
// once, loads its data the first time it is opened, and only re-renders
// after that. The tab row itself is the Reports space's row in the top bar
// (SPACES in main.js), which sets `reports.reportTab` and reopens the page,
// so there is never a second row of tabs inside the page.
//
// Every tab's nodes are appended straight into the page body (not wrapped
// in a container) and hidden or shown together, so the page's
// sibling-based spacing rules keep working unchanged.

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

  function select(key) {
    const target = tabs.find((t) => t.key === key) || tabs[0];
    if (!target.pane) {
      target.pane = target.build();
      root.append(...target.pane.nodes);
    }
    for (const tab of tabs) {
      const active = tab === target;
      for (const node of tab.pane?.nodes || []) node.hidden = !active;
    }
    settings.reportTab = target.key;
    store.save();
    target.pane.show();
  }

  select(settings.reportTab || "spending");
}
