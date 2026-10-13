// The category history dialog: every transaction in one category, grouped
// by month. Opened from YNAB Budget and from the report tabs.

import { fmt } from "../money.js";
import * as history from "../tools/category_history.js";
import {
  button, clear, customDialog, dateLabel, el, emptyRow, hint, monthLabel,
  pill, table, textInput,
} from "../ui.js";
import { groupNameMap, localMonth, stat } from "./report_kit.js";

/** A category name that opens its history; looks like plain text until hovered. */
export function categoryLink(app, category, { text = category.name, focusMonth, log } = {}) {
  return el("button", {
    type: "button", class: "category-link", text,
    title: `See every transaction in ${category.name}, by month`,
    onClick: () => openCategoryHistory(app, category, { focusMonth, log }),
  });
}

/**
 * Every transaction in one category, newest month first, each month
 * rolled up to a header with its total and a bar against the biggest
 * month. The month being looked at on the page starts open; the rest
 * start rolled up so a long history stays scannable. A search opens
 * every month that has a match.
 */
export async function openCategoryHistory(app, category, { focusMonth = localMonth(), log } = {}) {
  const state = app.state;
  if (!state.token || !state.budgetId) {
    log?.write("Connect and choose a budget on the Setup page first.", "error");
    return;
  }
  const loaded = await app.run(() => state.loadAllTransactions(), { log });
  if (!loaded) return;

  const all = history.categoryEntries(loaded.list, category.id);
  const groupName = groupNameMap(state).get(category.id) || "";

  customDialog(category.name, (body) => {
    const everything = history.groupByMonth(all);
    const summary = history.summarise(everything, localMonth());
    const open = new Set([
      everything.some((g) => g.month === focusMonth) ? focusMonth : everything[0]?.month,
    ].filter(Boolean));

    body.append(
      hint(groupName
        ? `${groupName} - everything that has gone through this category.`
        : "Everything that has gone through this category."),
      el("div", { class: "stat-grid" },
        stat(monthLabel(focusMonth),
          fmt(everything.find((g) => g.month === focusMonth)?.net || 0),
          { note: "Activity" }),
        stat("Average month", fmt(summary.average), { note: "Over the last 12 full months" }),
        stat("Biggest month", summary.biggest ? fmt(summary.biggest.net) : "-",
          { note: summary.biggest ? monthLabel(summary.biggest.month) : "" }),
        stat("Transactions", String(summary.count), {
          note: everything.length
            ? `Since ${monthLabel(everything[everything.length - 1].month)}` : "",
        })));

    const query = textInput("", { placeholder: "Search payee or memo..." });
    const status = hint("");
    body.append(el("div", { class: "card-row" },
      el("div", { class: "grow" }, query),
      button("Expand all", { small: true, onClick: () => setAll(true) }),
      button("Collapse all", { small: true, onClick: () => setAll(false) })));

    const list = table([
      { key: "date", label: "Date" },
      { key: "payee", label: "Payee" },
      { key: "account", label: "Account" },
      { key: "amount", label: "Amount", className: "num" },
    ]);
    list.classList.add("scroll-table", "history-table");
    body.append(list, status);

    let groups = everything;

    function setAll(expand) {
      open.clear();
      if (expand) groups.forEach((g) => open.add(g.month));
      draw();
    }

    function draw() {
      const needle = query.value.trim();
      groups = needle
        ? history.groupByMonth(all.filter((e) => history.matchesQuery(e, needle)))
        : everything;
      clear(list.tbody);
      if (!groups.length) {
        emptyRow(list, needle ? `Nothing matches "${needle}".`
          : "Nothing has gone through this category yet.");
        status.textContent = "";
        return;
      }

      const scale = Math.max(1, ...groups.map((g) => g.spent - g.inflow));
      for (const group of groups) {
        // A search shows what it matched, whatever was rolled up.
        const expanded = Boolean(needle) || open.has(group.month);
        const spend = Math.max(0, group.spent - group.inflow);
        list.tbody.append(el("tr", {
          class: `group-row history-month${group.month === focusMonth ? " is-focus" : ""}`,
        },
        el("td", { colspan: "3" },
          el("button", {
            type: "button", class: "group-toggle", "aria-expanded": String(expanded),
            onClick: () => {
              if (open.has(group.month)) open.delete(group.month);
              else open.add(group.month);
              draw();
            },
          },
          el("span", { class: "caret", "aria-hidden": "true", text: "▾" }),
          el("span", { class: "history-month-name", text: monthLabel(group.month) }),
          el("span", { class: "count", text: `${group.entries.length}` }),
          el("span", { class: "progress month-bar", "aria-hidden": "true" },
            el("span", { style: `width:${Math.round((spend / scale) * 100)}%` })))),
        el("td", {
          class: `num ${group.net > 0 ? "is-ok" : ""}`,
          text: fmt(group.net),
        })));

        if (!expanded) continue;
        for (const entry of group.entries) {
          list.tbody.append(el("tr", {},
            el("td", { class: "indent", text: dateLabel(entry.date) }),
            el("td", {},
              el("div", { class: "history-payee" },
                el("span", { text: entry.payee || "(no payee)" }),
                entry.splitLeg ? pill("Split", "muted") : null,
                entry.approved ? null : pill("Unapproved", "caution")),
              entry.memo ? el("div", { class: "hint", text: entry.memo }) : null),
            el("td", { class: "hint", text: entry.accountName }),
            el("td", {
              class: `num ${entry.amount > 0 ? "is-ok" : ""}`,
              text: entry.amount > 0 ? `+${fmt(entry.amount)}` : fmt(entry.amount),
            })));
        }
      }

      const shown = groups.reduce((sum, g) => sum + g.entries.length, 0);
      const net = groups.reduce((sum, g) => sum + g.net, 0);
      status.textContent = `${shown} ${needle ? "matching " : ""}transaction(s) across ` +
        `${groups.length} month(s), ${fmt(net)} in all.`;
    }

    query.addEventListener("input", draw);
    draw();
    setTimeout(() => query.focus(), 0);
    return { value: () => true };
  }, { confirmText: "Close", cancelText: "", hideCancel: true, wide: true });
}
