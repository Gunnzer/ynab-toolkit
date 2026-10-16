// Home's widgets: what each one is and how it draws itself at each size.
//
// Sizes follow the usual widget convention - small is one number you can
// read at a glance, medium adds a short list, large the full detail - so a
// bigger widget shows more, not the same thing stretched. Every widget
// reads through one shared context, so the history, the month and the
// forecast are each loaded once however many widgets want them.

import { fmt } from "../money.js";
import { fullMonthsBefore, pace, shiftMonth, spendingByMonth, spentThroughDay } from "../tools/budget_actual.js";
import { cashFlow } from "../tools/cash_flow.js";
import { dailyBalances, selectionName, spendingSeries } from "../tools/chart_data.js";
import { buildAlerts } from "../tools/dashboard.js";
import * as duplicates from "../tools/duplicates.js";
import { CASH_TYPES } from "../tools/forecast.js";
import { findRecurring, recurringTotals } from "../tools/recurring.js";
import { readyToAssignCategoryIds } from "../tools/rta_tracker.js";
import * as sheet from "../tools/split_sheet.js";
import { button, clear, el, hint, icon, monthLabel, pill, select } from "../ui.js";
import { buildQueue } from "./categorize.js";
import { chartLegend, columnChart, lineChart, OTHER_COLOR, SERIES_COLORS } from "./home_charts.js";
import { assignableCategories, localMonth, localToday } from "./report_kit.js";
import { loadForecast } from "./upcoming.js";

// ---------- shared data ----------

function daysAgoIso(days) {
  const when = new Date();
  when.setDate(when.getDate() - days);
  return localToday(when);
}

function memo(load) {
  let promise = null;
  return () => (promise ||= load());
}

/**
 * Whose things count, for Home's "Whose" choice (Everyone / a person /
 * Shared) - the same rules as everywhere else in the app: a category by
 * its group's person prefix (`ownerOf()`), an account by its tag or name
 * (`payerOf()`, where "shared" means a joint account), a transaction by
 * its category, or by its account when it has none of its own (no
 * category yet, or YNAB's internal one).
 */
function ownership(state, owner) {
  const everyone = !owner || owner === "all";
  const people = state.withPeople({});
  const accountSettings = { ...people, accountOwners: state.store.get("splitSheet.accountOwners", {}) || {} };
  const groupOf = new Map();
  for (const group of state.categoryGroups || []) {
    for (const category of group.categories || []) groupOf.set(category.id, group.name);
  }
  const categoryMine = (id) => everyone || sheet.ownerOf(groupOf.get(id) || "", "", people) === owner;
  const accountMine = (id) => everyone ||
    sheet.payerOf(state.accountName(id), accountSettings) === (owner === "shared" ? "joint" : owner);
  // YNAB's internal categories (Ready to Assign, Uncategorized) and card
  // payments have no person prefix, so ownerOf() would call them "shared" -
  // which put the whole budget's income into Shared's spending (a real bug,
  // caught live). Anything in them goes by its account instead.
  const ownCategory = (id) => Boolean(id) && groupOf.has(id) &&
    groupOf.get(id) !== "Internal Master Category" && groupOf.get(id) !== "Credit Card Payments";
  const itemMine = (categoryId, accountId) => everyone ||
    (ownCategory(categoryId) ? categoryMine(categoryId) : accountMine(accountId));
  const transactionMine = (t) => {
    if (everyone) return true;
    const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
    if (legs.length) return legs.some((leg) => (ownCategory(leg.category_id) ? categoryMine(leg.category_id) : accountMine(t.account_id)));
    return ownCategory(t.category_id) ? categoryMine(t.category_id) : accountMine(t.account_id);
  };
  /**
   * How much of an amount is this person's, 0 to 1. A split is shared out
   * leg by leg (a $200 grocery run split $100 / $100 is half each) - the
   * first cut credited the whole of it to whoever's card it was on, so a
   * split recurring charge or bill showed in full for one person and not
   * at all for the other (found testing every widget per person).
   */
  const shareOf = (legs, categoryId, accountId) => {
    if (everyone) return 1;
    const live = (legs || []).filter((leg) => !leg.deleted);
    if (!live.length) return itemMine(categoryId, accountId) ? 1 : 0;
    const size = (leg) => Math.abs(leg.amount || 0);
    const total = live.reduce((sum, leg) => sum + size(leg), 0);
    if (!total) return 0;
    const legCategory = (leg) => leg.category_id ?? leg.categoryId;
    return live.filter((leg) => itemMine(legCategory(leg), accountId)).reduce((sum, leg) => sum + size(leg), 0) / total;
  };
  return { everyone, categoryMine, accountMine, transactionMine, itemMine, ownCategory, shareOf };
}

/**
 * One per page build (and per "Whose" choice): each source is loaded the
 * first time a widget asks, and handed out already narrowed to that
 * person, so a widget only has to know when its figure cannot be split by
 * person at all (Ready to Assign, income).
 */
export function widgetContext(app, owner = "all") {
  const state = app.state;
  const today = localToday();
  const current = localMonth();
  const mine = ownership(state, owner);
  const ctx = {
    today,
    current,
    owner,
    filtered: !mine.everyone,
    ownerName: owner === "p1" || owner === "p2" ? state.personName(owner === "p1" ? 1 : 2) : owner === "shared" ? "Shared" : "",
    ...mine,
    day: new Date().getDate(),
    // Everything, unfiltered: what Ready to Assign and cash flow income need.
    allList: memo(async () => (await state.loadAllTransactions()).list),
    list: memo(async () => (await ctx.allList()).filter(mine.transactionMine)),
    month: memo(async () => (await state.month(current)).data),
    forecast: memo(async () => {
      const all = await loadForecast(state, { days: 30 });
      if (mine.everyone) return all;
      // Account balances stay whole (an account is someone's, or joint);
      // a bill is that person's share of it.
      const recurringShare = await ctx.recurringShares();
      const events = all.events.map((e) => {
        const share = e.recurringKey && recurringShare.has(e.recurringKey)
          ? recurringShare.get(e.recurringKey)
          : mine.shareOf(e.legs, e.categoryId, e.accountId);
        return share ? { ...e, amount: Math.round(e.amount * share), share } : null;
      }).filter(Boolean);
      return { ...all, accounts: all.accounts.filter((a) => mine.accountMine(a.id)), events };
    }),
    // Each recurring charge's (and income's) share for this person - by
    // key, so the forecast's bills can use it too. Taken across all of its
    // charges, weighted by amount, and a charge with no category of its own
    // counts as the series' usual one: going by the latest charge alone, a
    // still-uncategorized latest SHELL charge on Alex's card handed a shared
    // Gas series to Alex (found testing per person).
    recurringShares: memo(async () => {
      const list = await ctx.allList();
      const byId = new Map(list.map((t) => [t.id, t]));
      const shares = new Map();
      for (const r of [...findRecurring(list, { today }), ...findRecurring(list, { today, direction: "in" })]) {
        let mineTotal = 0;
        let total = 0;
        for (const id of r.transactionIds) {
          const t = byId.get(id);
          if (!t) continue;
          const size = Math.abs(t.amount || 0);
          const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
          const share = legs.length
            ? mine.shareOf(legs, null, t.account_id)
            : mine.shareOf(null, mine.ownCategory(t.category_id) ? t.category_id : r.categoryId, t.account_id);
          mineTotal += share * size;
          total += size;
        }
        shares.set(r.key, total ? mineTotal / total : 0);
      }
      return shares;
    }),
    recurring: memo(async () => {
      const found = findRecurring(await ctx.allList(), { today }).filter((r) => !r.stopped);
      if (mine.everyone) return found;
      const shares = await ctx.recurringShares();
      const scale = (amount, share) => Math.round(amount * share);
      return found.map((r) => {
        const share = shares.get(r.key) || 0;
        if (share === 1) return r;
        return {
          ...r,
          share,
          typical: scale(r.typical, share),
          usual: scale(r.usual, share),
          latest: scale(r.latest, share),
          yearly: scale(r.yearly, share),
          priceUp: r.priceUp ? { from: scale(r.priceUp.from, share), to: scale(r.priceUp.to, share) } : null,
        };
      }).filter((r) => r.share !== 0);
    }),
    // Month categories with their real names, budget categories only.
    categories: memo(async () => {
      const assignable = new Map(assignableCategories(state).map((c) => [c.id, c]));
      return ((await ctx.month()).categories || [])
        .filter((c) => assignable.has(c.id) && mine.categoryMine(c.id))
        .map((c) => ({ ...c, name: assignable.get(c.id).name, groupName: assignable.get(c.id).groupName }));
    }),
    alerts: memo(async () => buildAlerts(await gatherFacts(app, ctx))),
    // Settling up is between the two people, so it is never narrowed.
    settle: memo(async () => settleCycles(state, await ctx.allList(), today)),
    spending: memo(async () => {
      const all = spendingByMonth(await ctx.allList());
      return mine.everyone ? all : new Map([...all].filter(([id]) => mine.ownCategory(id) && mine.categoryMine(id)));
    }),
    queue: memo(async () => buildQueue(state, await ctx.allList()).filter((i) => mine.transactionMine(i.transaction))),
  };
  return ctx;
}

/**
 * Everything "Needs attention" reports on, from tools that are switched
 * on. The same facts the dashboard has always used.
 */
async function gatherFacts(app, ctx) {
  const state = app.state;
  const store = state.store;
  const list = await ctx.list();
  const facts = {};

  if (app.toolEnabled("budgetOverview")) {
    facts.readyToAssign = (await ctx.month()).to_be_budgeted ?? null;
    facts.overspent = (await ctx.categories()).filter((c) => (c.balance || 0) < 0)
      .sort((a, b) => a.balance - b.balance);
  }

  if (app.toolEnabled("reports")) {
    facts.pace = pace({
      categories: await ctx.categories(), transactions: await ctx.allList(), currentMonth: ctx.current,
      day: ctx.day, lookback: fullMonthsBefore(ctx.current, 6),
    });
    const recurring = await ctx.recurring();
    facts.recurring = {
      priceUp: recurring.filter((r) => r.priceUp),
      fresh: recurring.filter((r) => r.isNew),
    };
  }

  if (app.toolEnabled("categorize")) {
    const queue = await ctx.queue();
    facts.review = {
      unapproved: queue.filter((i) => i.needsApproval).length,
      uncategorized: queue.filter((i) => i.needsCategory).length,
      suggested: queue.filter((i) => i.needsCategory && i.suggestion?.usable).length,
    };
  }

  if (app.toolEnabled("duplicates")) {
    const since = daysAgoIso(30);
    const groups = duplicates.find(list.filter((t) => t.date >= since), {
      withinDays: store.get("duplicates.withinDays", 3) ?? 3,
      ignoreTransfers: true,
    });
    // Once flagged in the Duplicates tool, a group has been dealt with.
    facts.duplicateGroups = groups.filter((g) =>
      g.transactions.slice(1).some((t) => !t.flag_color)).length;
  }

  if (app.toolEnabled("upcoming")) {
    const forecast = await ctx.forecast();
    const soon = localToday(new Date(Date.now() + 7 * 86400000));
    const dueSoon = forecast.events.filter((e) => e.amount < 0 && e.date <= soon);
    facts.forecast = {
      accounts: forecast.accounts,
      dueSoon: { count: dueSoon.length, total: dueSoon.reduce((s, e) => s + e.amount, 0), items: dueSoon },
    };
  }

  if (app.toolEnabled("splitSheet") && state.peopleNamed) {
    const recent = daysAgoIso(60);
    facts.settle = (await ctx.settle())
      .filter((c) => c.closed && c.end >= recent && (c.status === "unpaid" || c.status === "possible"))
      .map((c) => ({ key: c.key, label: c.label, status: c.status, paid: c.paid, who: c.who }));
  }

  return facts;
}

/**
 * Bill Splitting's cycles from the last few months with their settle up
 * status, newest first - worked out exactly as Bill Splitting's own
 * summary does.
 */
function settleCycles(state, list, today) {
  if (!state.peopleNamed) return [];
  const settings = state.withPeople(state.store.section("splitSheet"));
  const groupOf = new Map();
  for (const group of state.categoryGroups || []) {
    for (const category of group.categories || []) groupOf.set(category.id, group.name);
  }
  const since = daysAgoIso(200);
  const source = sheet.fromApi(list.filter((t) => t.date >= since), (id) => groupOf.get(id) || "", settings);
  const rows = sheet.buildRows(source.items, settings).filter((row) => row.Amount >= 0);
  const cycles = sheet.monthlySummary(rows, settings);
  const matches = sheet.matchSettlements(cycles, list, settings, {
    accountNameOf: (id) => state.accountName(id),
    manual: settings.settleMatches || {},
  });
  return cycles.map((cycle) => {
    const match = matches.get(cycle.key);
    const end = localToday(cycle.end);
    return {
      key: cycle.key,
      label: cycle.label,
      end,
      closed: end < today,
      status: match?.status || (cycle.settleFrom ? "unpaid" : "even"),
      paid: match?.payment ? match.payment.amount * 1000 : 0,
      who: cycle.settleFrom
        ? `${state.personName(cycle.settleFrom)} pays ${state.personName(cycle.settleFrom === 1 ? 2 : 1)} ` +
          fmt(cycle.settleAmount * 1000)
        : "Nobody owes anything",
    };
  });
}

// ---------- drawing helpers ----------

/** The one big number a small widget is about. */
function big(value, note = "", kind = "") {
  return el("div", { class: "widget-big" },
    el("div", { class: `widget-value ${kind ? `is-${kind}` : ""}`.trim(), text: value }),
    note ? el("div", { class: "widget-note", text: note }) : null);
}

/** Label on the left, amount on the right, optional second line and pill. */
function rows(items) {
  const list = el("ul", { class: "widget-rows" });
  for (const item of items) {
    list.append(el("li", { class: item.kind ? `is-${item.kind}` : "" },
      el("div", { class: "widget-row-main" },
        el("span", { class: "widget-row-label", text: item.label }),
        item.sub ? el("span", { class: "widget-row-sub", text: item.sub }) : null),
      item.pill ? pill(item.pill[0], item.pill[1]) : null,
      item.value !== undefined
        ? el("span", { class: `widget-row-value ${item.valueKind ? `is-${item.valueKind}` : ""}`.trim(), text: item.value })
        : null,
      item.bar !== undefined
        ? el("span", { class: "widget-bar" }, el("span", { style: `width:${Math.round(Math.max(0, Math.min(1, item.bar)) * 100)}%` }))
        : null));
  }
  return list;
}

function more(count) {
  // "" not null: this goes straight into a native append(), which prints null.
  return count > 0 ? hint(`and ${count} more`) : "";
}

function shortDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function signed(milliunits) {
  return milliunits > 0 ? `+${fmt(milliunits)}` : fmt(milliunits);
}

const LIMIT = { s: 0, m: 4, l: 10 };

// ---------- the widgets ----------

const LEVEL_PILL = { error: ["Now", "error"], warn: ["Soon", "warn"], info: ["FYI", "info"] };

function attentionWidget(body, size, ctx, app) {
  return ctx.alerts().then((alerts) => {
    if (!alerts.length) {
      body.append(big("All clear", "Nothing needs you right now.", "ok"));
      return;
    }
    if (size === "s") {
      const urgent = alerts.filter((a) => a.level === "error").length;
      const counts = ["error", "warn", "info"]
        .map((level) => [level, alerts.filter((a) => a.level === level).length])
        .filter(([, n]) => n)
        .map(([level, n]) => `${n} ${LEVEL_PILL[level][0].toLowerCase()}`);
      body.append(big(String(alerts.length), `${alerts.length === 1 ? "thing needs" : "things need"} you: ${counts.join(", ")}`,
        urgent ? "error" : "warn"));
      return;
    }
    const shown = size === "m" ? alerts.slice(0, 3) : alerts;
    const list = el("div", { class: "attention-list-compact" });
    for (const alert of shown) {
      list.append(el("div", { class: `attention-item is-${alert.level}` },
        pill(...LEVEL_PILL[alert.level]),
        el("div", { class: "attention-text" },
          el("div", { class: "attention-title", text: alert.title }),
          size === "l" && alert.detail ? el("div", { class: "hint", text: alert.detail }) : null),
        button("Open", {
          small: true,
          onClick: () => {
            if (alert.tab) app.state.store.set("reports.reportTab", alert.tab);
            app.go(alert.go);
          },
        })));
    }
    body.append(list, more(alerts.length - shown.length));
  });
}

async function readyToAssignWidget(body, size, ctx) {
  const month = await ctx.month();
  const rta = month.to_be_budgeted ?? 0;
  // Ready to Assign is money with no job yet, so nobody's in particular.
  const whole = ctx.filtered ? " (whole budget)" : "";
  body.append(big(fmt(rta), (rta < 0 ? "More is assigned than you have" : "Ready to Assign") + whole,
    rta < 0 ? "error" : rta > 0 ? "ok" : ""));
  if (size === "s") return;
  const categories = ctx.filtered ? await ctx.categories() : null;
  const sum = (key) => categories.reduce((total, c) => total + (c[key] || 0), 0);
  body.append(rows([
    { label: `Assigned this month${ctx.filtered ? `, ${ctx.ownerName}` : ""}`, value: fmt(categories ? sum("budgeted") : month.budgeted || 0) },
    { label: `Activity${ctx.filtered ? `, ${ctx.ownerName}` : ""}`, value: fmt(categories ? sum("activity") : month.activity || 0) },
    { label: `Income${whole}`, value: fmt(month.income || 0) },
    ...(size === "l" && month.age_of_money != null
      ? [{ label: "Age of money", value: `${month.age_of_money} days` }]
      : []),
  ]));
}

/** Open accounts, narrowed to the ones a widget's settings chose (none chosen: all). */
function chosenAccounts(app, config, ctx) {
  const open = (app.state.accounts || []).filter((a) => !a.deleted && !a.closed && (!ctx || ctx.accountMine(a.id)));
  const chosen = new Set(config?.accountIds || []);
  return chosen.size ? open.filter((a) => chosen.has(a.id)) : open;
}

/** Settings: a tick per account, none ticked meaning all of them. */
function accountFields(filter) {
  return (body, config, app) => {
    const accounts = (app.state.accounts || []).filter((a) => !a.deleted && !a.closed && filter(a));
    const chosen = new Set(config.accountIds || []);
    const boxes = accounts.map((a) => {
      const box = el("input", { type: "checkbox" });
      box.checked = chosen.has(a.id);
      return [a.id, el("label", { class: "checkbox" }, box, el("span", { text: a.name })), box];
    });
    body.append(el("label", { class: "field-label", text: "Accounts" }),
      hint("Leave them all unticked to include every one, including accounts you open later."),
      el("div", { class: "settings-checks" }, ...boxes.map(([, label]) => label)));
    return { value: () => ({ accountIds: boxes.filter(([, , box]) => box.checked).map(([id]) => id) }) };
  };
}

function accountsWidget(body, size, ctx, app, config) {
  const open = chosenAccounts(app, config, ctx);
  if (!open.length) {
    body.append(hint(ctx.filtered
      ? `None of the accounts this widget shows are ${ctx.ownerName === "Shared" ? "joint" : `${ctx.ownerName}'s`}.`
      : "No open accounts to show."));
    return;
  }
  const cash = open.filter((a) => a.on_budget !== false && CASH_TYPES.has(a.type));
  const debt = open.filter((a) => a.on_budget !== false && !CASH_TYPES.has(a.type));
  const tracking = open.filter((a) => a.on_budget === false);
  const sum = (list) => list.reduce((total, a) => total + (a.balance || 0), 0);

  body.append(big(fmt(sum(cash)), "In chequing, savings and cash"));
  if (size === "s") return;

  const line = (a) => ({ label: a.name, value: fmt(a.balance || 0), valueKind: (a.balance || 0) < 0 ? "error" : "" });
  const byBalance = (list) => [...list].sort((a, b) => Math.abs(b.balance || 0) - Math.abs(a.balance || 0));
  if (size === "m") {
    body.append(rows([
      ...byBalance(cash).slice(0, 4).map(line),
      ...(debt.length ? [{ label: "Cards and loans", sub: `${debt.length} account(s)`, value: fmt(sum(debt)) }] : []),
    ]));
    return;
  }
  const section = (title, list) => (list.length
    ? [el("div", { class: "widget-subhead", text: `${title}  ${fmt(sum(list))}` }), rows(byBalance(list).map(line))]
    : []);
  body.append(
    ...section("Cash", cash),
    ...section("Cards and loans", debt),
    ...section("Tracking", tracking),
    rows([{ label: "Net worth", value: fmt(sum(open)), kind: "total" }]));
}

async function upcomingWidget(body, size, ctx, app, config) {
  const forecast = await ctx.forecast();
  const ahead = Number(config?.days) || 7;
  const soon = localToday(new Date(Date.now() + ahead * 86400000));
  const dueSoon = forecast.events.filter((e) => e.amount < 0 && e.date <= soon);
  const negative = forecast.accounts.filter((a) => a.firstNegative);
  const total = dueSoon.reduce((s, e) => s + e.amount, 0);

  body.append(big(
    `${dueSoon.length} bill${dueSoon.length === 1 ? "" : "s"}`,
    dueSoon.length ? `${fmt(-total)} due in the next ${ahead} days` : `Nothing due in the next ${ahead} days`,
    negative.length ? "error" : ""));
  if (negative.length) {
    body.append(el("p", { class: "widget-warning",
      text: `${negative.map((a) => a.name).join(", ")} could go below zero` }));
  }
  if (size === "s") return;

  const horizon = localToday(new Date(Date.now() + (size === "l" ? Math.max(14, ahead) : ahead) * 86400000));
  const events = forecast.events.filter((e) => e.date <= horizon);
  const shown = events.slice(0, LIMIT[size]);
  body.append(shown.length
    ? rows(shown.map((e) => ({
      label: e.payee,
      sub: `${e.late ? "Due" : shortDate(e.date)}${e.how ? ` · ${e.how}` : ""}`,
      value: signed(e.amount),
      valueKind: e.amount > 0 ? "ok" : "",
    })))
    : hint("Nothing expected."),
  more(events.length - shown.length));
  if (size === "l" && forecast.accounts.length) {
    body.append(el("div", { class: "widget-subhead", text: "Lowest balance in the next 30 days" }),
      rows(forecast.accounts.map((a) => ({
        label: a.name,
        sub: a.low < a.start ? shortDate(a.lowDate) : "",
        value: fmt(a.low),
        valueKind: a.low < 0 ? "error" : "",
      }))));
  }
}

async function spendingWidget(body, size, ctx, app) {
  const list = await ctx.list();
  const categories = new Map(assignableCategories(app.state).filter((c) => ctx.categoryMine(c.id)).map((c) => [c.id, c]));
  const spent = (month) => [...spentThroughDay(list, month, ctx.day)]
    .filter(([id]) => categories.has(id));
  const now = spent(ctx.current);
  const before = new Map(spent(shiftMonth(ctx.current, 1)));
  const total = now.reduce((s, [, amount]) => s + amount, 0);
  const lastTotal = [...before.values()].reduce((s, amount) => s + amount, 0);
  const change = total - lastTotal;

  body.append(big(fmt(total),
    lastTotal
      ? `${change >= 0 ? fmt(change) + " more" : fmt(-change) + " less"} than by this day last month`
      : "Spent so far this month",
    change > 0 && lastTotal && change / lastTotal > 0.1 ? "warn" : ""));
  if (size === "s") return;

  const top = now.filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
  const shown = top.slice(0, size === "m" ? 3 : 8);
  const most = shown[0]?.[1] || 1;
  body.append(rows(shown.map(([id, amount]) => ({
    label: categories.get(id).name,
    sub: size === "l" ? `${fmt(before.get(id) || 0)} by now last month` : "",
    value: fmt(amount),
    bar: size === "l" ? amount / most : undefined,
  }))), more(top.length - shown.length));
}

async function overspentWidget(body, size, ctx) {
  const over = (await ctx.categories()).filter((c) => (c.balance || 0) < 0)
    .sort((a, b) => a.balance - b.balance);
  if (!over.length) {
    body.append(big("None", "Nothing is overspent this month.", "ok"));
    return;
  }
  const total = over.reduce((s, c) => s + c.balance, 0);
  body.append(big(String(over.length), `categor${over.length === 1 ? "y" : "ies"} overspent by ${fmt(-total)}`, "error"));
  if (size === "s") return;
  const shown = over.slice(0, LIMIT[size]);
  body.append(rows(shown.map((c) => ({ label: c.name, sub: c.groupName, value: fmt(c.balance), valueKind: "error" }))),
    more(over.length - shown.length));
}

async function reviewWidget(body, size, ctx, app) {
  const queue = await ctx.queue();
  if (!queue.length) {
    body.append(big("Done", "Everything is categorized and approved.", "ok"));
    return;
  }
  const missing = queue.filter((i) => i.needsCategory).length;
  const approve = queue.filter((i) => i.needsApproval).length;
  body.append(big(String(queue.length),
    [missing ? `${missing} with no category` : "", approve ? `${approve} to approve` : ""].filter(Boolean).join(", "),
    missing ? "warn" : ""));
  if (size === "s") return;
  const shown = queue.slice(0, size === "m" ? 3 : 8);
  body.append(rows(shown.map((i) => ({
    label: i.transaction.payee_name || "(no payee)",
    sub: shortDate(i.transaction.date),
    pill: i.needsCategory ? ["No category", "warn"] : null,
    value: fmt(i.transaction.amount || 0),
  }))), more(queue.length - shown.length));
}

const SETTLE_PILL = {
  paid: ["Paid", "ok"], possible: ["Check", "warn"], unpaid: ["Not paid", "error"],
  open: ["Cycle open", "muted"], even: ["Even", "ok"],
};

async function settleWidget(body, size, ctx, app) {
  if (!app.state.peopleNamed) {
    body.append(hint("Name the two people in Setup to see settle ups here."));
    return;
  }
  const cycles = await ctx.settle();
  const closed = cycles.filter((c) => c.closed);
  const latest = closed[0];
  if (!latest) {
    body.append(hint("No finished cycles yet."));
    return;
  }
  const [label, kind] = SETTLE_PILL[latest.status] || SETTLE_PILL.unpaid;
  body.append(big(label, `${latest.label}: ${latest.who}`, kind === "error" ? "error" : kind === "warn" ? "warn" : "ok"));
  if (size === "s") return;
  const shown = cycles.slice(0, size === "m" ? 3 : 6);
  body.append(rows(shown.map((c) => ({
    label: c.label,
    sub: c.who,
    pill: c.closed ? SETTLE_PILL[c.status] || SETTLE_PILL.unpaid : SETTLE_PILL.open,
  }))));
}

async function recurringWidget(body, size, ctx) {
  const found = await ctx.recurring();
  const { monthly, yearly } = recurringTotals(found);
  body.append(big(fmt(monthly), `a month in ${found.length} recurring charge${found.length === 1 ? "" : "s"}`));
  if (size === "s") return;
  const flagged = (r) => (r.priceUp ? 2 : r.isNew ? 1 : 0);
  const ordered = [...found].sort((a, b) => flagged(b) - flagged(a) || b.yearly - a.yearly);
  const shown = ordered.slice(0, LIMIT[size]);
  body.append(rows(shown.map((r) => ({
    label: r.payee,
    sub: r.priceUp ? `${fmt(r.priceUp.from)} to ${fmt(r.priceUp.to)}` : r.cadenceLabel,
    pill: r.priceUp ? ["Went up", "warn"] : r.isNew ? ["New", "info"] : null,
    value: fmt(r.typical),
  }))), more(ordered.length - shown.length));
  if (size === "l") body.append(hint(`${fmt(yearly)} a year in all.`));
}

const MONTH_SHORT = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};

/** One person's (or the shared) spending by month - income is not split by person. */
async function personSpendingFlow(body, size, ctx) {
  const spending = await ctx.spending();
  const full = fullMonthsBefore(ctx.current, size === "l" ? 12 : 6);
  const months = [...full, ctx.current];
  const values = months.map((m) => [...spending.values()].reduce((sum, byMonth) => sum + (byMonth.get(m) || 0), 0));
  const last = values[values.length - 2];
  body.append(big(fmt(last), `spent in ${monthLabel(full[full.length - 1])}, ${ctx.ownerName}`));
  if (size === "s") return;
  const average = Math.round(values.slice(0, -1).reduce((a, b) => a + b, 0) / full.length);
  body.append(
    columnChart({
      labels: months.map(MONTH_SHORT), titles: months.map(monthLabel),
      series: [{ name: "Spending", values, color: SERIES_COLORS[1] }],
      partialLast: true, average, height: size === "l" ? 210 : 170,
      ariaLabel: `${ctx.ownerName} spending by month`,
    }),
    hint("Income is not split by person, so this shows spending only. " +
      `The line is the average of the last ${full.length} full months.`));
}

async function cashFlowWidget(body, size, ctx, app) {
  if (ctx.filtered) return personSpendingFlow(body, size, ctx);
  const list = await ctx.list();
  const full = fullMonthsBefore(ctx.current, size === "l" ? 12 : 6);
  const flow = cashFlow({
    transactions: list,
    rtaIds: readyToAssignCategoryIds(app.state.categoryGroups),
    months: [...full, ctx.current],
  });
  const last = flow[flow.length - 2];
  body.append(big(fmt(last.leftOver),
    `left over in ${monthLabel(last.month)}${last.rate !== null ? `, ${Math.round(last.rate * 100)}% of income` : ""}`,
    last.leftOver < 0 ? "error" : "ok"));
  if (size === "s") return;

  const done = flow.slice(0, -1);
  const sum = (key) => done.reduce((total, r) => total + r[key], 0);
  const series = [
    { name: "Income", values: flow.map((r) => r.income), color: SERIES_COLORS[0] },
    { name: "Spending", values: flow.map((r) => r.spending), color: SERIES_COLORS[1] },
  ];
  body.append(
    columnChart({
      labels: flow.map((r) => MONTH_SHORT(r.month)),
      titles: flow.map((r) => monthLabel(r.month)),
      series, mode: "group", partialLast: true, height: size === "l" ? 210 : 170,
      ariaLabel: `Income and spending by month, last ${done.length} months and this month so far`,
    }),
    chartLegend([
      { name: "Income", color: SERIES_COLORS[0], value: `${fmt(Math.round(sum("income") / done.length))} a month` },
      { name: "Spending", color: SERIES_COLORS[1], value: `${fmt(Math.round(sum("spending") / done.length))} a month` },
    ]),
    hint(`Averages over the last ${done.length} full months. The paler pair is this month so far.`));
}

async function forecastWidget(body, size, ctx, app, config) {
  const forecast = await ctx.forecast();
  const chosen = new Set(config?.accountIds || []);
  const accounts = chosen.size ? forecast.accounts.filter((a) => chosen.has(a.id)) : forecast.accounts;
  if (!accounts.length) {
    body.append(hint("No chequing, savings or cash accounts to forecast."));
    return;
  }
  const worst = accounts[0];
  body.append(big(fmt(worst.low),
    `lowest point, ${worst.name}${worst.low < worst.start ? ` on ${shortDate(worst.lowDate)}` : ""}`,
    worst.low < 0 ? "error" : ""));
  if (size === "s") return;

  const days = 30;
  const shown = accounts.slice(0, SERIES_COLORS.length);
  const daily = shown.map((a) => dailyBalances(a, forecast.today, days));
  const series = shown.map((a, i) => ({
    name: a.name, values: daily[i].map((d) => d.balance), color: SERIES_COLORS[i],
  }));
  body.append(
    lineChart({
      dates: daily[0].map((d, i) => (i === 0 ? "Today" : shortDate(d.date))),
      titles: daily[0].map((d, i) => (i === 0 ? "Today" : shortDate(d.date))),
      series, height: size === "l" ? 220 : 170,
      ariaLabel: "Each account's balance over the next 30 days, from scheduled and expected transactions",
    }),
    chartLegend(shown.map((a, i) => ({
      name: a.name, color: SERIES_COLORS[i], value: `low ${fmt(a.low)}`,
    })), { line: true }));
  if (size === "l") {
    body.append(hint("From YNAB's scheduled transactions plus regular bills and pay spotted in your history. " +
      "Card spending is not counted until a payment is scheduled."));
  }
}

// ---------- spending in chosen categories ----------

/** Budget groups to choose from, in budget order. */
function choosableGroups(state) {
  return (state.categoryGroups || []).filter((g) => !g.deleted && !g.hidden &&
    g.name !== "Internal Master Category" && g.name !== "Credit Card Payments")
    .map((g) => ({ ...g, categories: (g.categories || []).filter((c) => !c.deleted && !c.hidden) }));
}

function hasSelection(config) {
  return Boolean(config?.all || config?.groupIds?.length || config?.categoryIds?.length);
}

async function categoryChartWidget(body, size, ctx, app, config) {
  if (!hasSelection(config)) {
    body.append(hint("Nothing chosen yet. Press Customize, then the gear on this widget, to pick categories or groups."));
    return;
  }
  const spending = await ctx.spending();
  const count = size === "l" ? 12 : 6;
  const months = [...fullMonthsBefore(ctx.current, count - 1), ctx.current];
  const groups = app.state.categoryGroups;
  const separate = Boolean(config.separate) && size !== "s";
  const series = spendingSeries({ spending, selection: config, categoryGroups: groups, months, separate })
    .map((s, i) => ({ ...s, color: s.other ? OTHER_COLOR : SERIES_COLORS[i] }));

  const totals = months.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  if (ctx.filtered && totals.every((v) => v === 0)) {
    body.append(hint(`Nothing in this chart belongs to ${ctx.ownerName === "Shared" ? "the shared categories" : ctx.ownerName}. ` +
      "Switch Whose to Everyone to see it."));
    return;
  }
  const full = totals.slice(0, -1);
  const average = full.length ? Math.round(full.reduce((a, b) => a + b, 0) / full.length) : 0;
  const now = totals[totals.length - 1];

  body.append(big(fmt(now), `so far this month, against ${fmt(average)} a month on average`,
    average && now > average ? "warn" : ""));

  const chart = (opts) => columnChart({
    labels: months.map(MONTH_SHORT),
    titles: months.map(monthLabel),
    partialLast: true,
    ariaLabel: `Spending on ${selectionName(config, groups) || "the chosen categories"} by month`,
    ...opts,
  });
  if (size === "s") {
    body.append(chart({ series: [{ ...series[0], name: "Spent", values: totals }], height: 46, mini: true }));
    return;
  }
  body.append(chart({ series, height: size === "l" ? 220 : 170, average: series.length === 1 ? average : null }));
  if (series.length > 1) {
    body.append(chartLegend(series.map((s) => ({
      name: s.name, color: s.color, value: fmt(s.values.slice(0, -1).reduce((a, b) => a + b, 0)),
    }))), hint(`Totals over the last ${full.length} full months. The paler column is this month so far.`));
  } else {
    body.append(hint(`The line is the average of the last ${full.length} full months. The paler column is this month so far.`));
  }
}

/**
 * The chart's settings: which categories or groups, and one colour each or
 * not. "All spending" and each group's box are select-all shortcuts (at
 * explicit user request - the first cut greyed out everything under a
 * ticked box): ticking one ticks everything under it, unticking anything
 * under it unticks it, and nothing is ever disabled. What is saved still
 * says what was meant - `all` when everything is ticked, a group's id when
 * all of its categories are - so a category or group added to the budget
 * later is picked up on its own.
 */
function categoryChartFields(body, config, app) {
  const groups = choosableGroups(app.state);
  const allBox = el("input", { type: "checkbox" });
  const separateBox = el("input", { type: "checkbox" });
  separateBox.checked = config.separate !== false && (config.separate || !hasSelection(config));
  const error = el("p", { class: "hint is-error" });

  const chosenGroups = new Set(config.groupIds || []);
  const chosenCategories = new Set(config.categoryIds || []);
  const groupBoxes = new Map();
  const categoryBoxes = new Map();
  const list = el("div", { class: "chart-choices" });
  for (const group of groups) {
    const groupBox = el("input", { type: "checkbox" });
    groupBoxes.set(group.id, groupBox);
    list.append(el("label", { class: "checkbox chart-choice-group" }, groupBox,
      el("span", { text: `${group.name} (whole group)` })));
    const boxes = group.categories.map((category) => {
      const box = el("input", { type: "checkbox" });
      box.checked = Boolean(config.all) || chosenGroups.has(group.id) || chosenCategories.has(category.id);
      categoryBoxes.set(category.id, box);
      list.append(el("label", { class: "checkbox chart-choice-category" }, box, el("span", { text: category.name })));
      box.addEventListener("change", sync);
      return box;
    });
    groupBox.checked = Boolean(config.all) || chosenGroups.has(group.id) ||
      (boxes.length > 0 && boxes.every((b) => b.checked));
    groupBox.addEventListener("change", () => {
      for (const box of boxes) box.checked = groupBox.checked;
      sync();
    });
    groupBox.categoryBoxes = boxes;
  }
  allBox.addEventListener("change", () => {
    for (const box of [...groupBoxes.values(), ...categoryBoxes.values()]) box.checked = allBox.checked;
  });

  // Work the shortcuts out again from the boxes under them.
  function sync() {
    for (const groupBox of groupBoxes.values()) {
      if (groupBox.categoryBoxes.length) groupBox.checked = groupBox.categoryBoxes.every((b) => b.checked);
    }
    allBox.checked = [...groupBoxes.values()].every((b) => b.checked);
  }
  sync();

  body.append(
    el("label", { class: "field-label", text: "What to show" }),
    el("label", { class: "checkbox chart-choice-all" }, allBox, el("span", { text: "All spending, by group" })),
    list,
    el("label", { class: "checkbox" }, separateBox,
      el("span", { text: "Show each group or category in its own colour (medium and large sizes)" })),
    error);
  return {
    validate: () => {
      const any = [...groupBoxes.values(), ...categoryBoxes.values()].some((b) => b.checked);
      error.textContent = any ? "" : "Choose at least one group or category.";
      return any;
    },
    value: () => {
      if (allBox.checked) return { all: true, groupIds: [], categoryIds: [], separate: separateBox.checked };
      const groupIds = [...groupBoxes].filter(([, b]) => b.checked).map(([id]) => id);
      const covered = new Set(groups.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.categories.map((c) => c.id)));
      return {
        all: false,
        groupIds,
        categoryIds: [...categoryBoxes].filter(([id, b]) => b.checked && !covered.has(id)).map(([id]) => id),
        separate: separateBox.checked,
      };
    },
  };
}

// ---------- tool links ----------

function linkedPages(app, config) {
  const enabled = app.enabledToolPages();
  if (!Array.isArray(config?.pages)) return enabled;
  const order = new Map(config.pages.map((id, i) => [id, i]));
  return enabled.filter((p) => order.has(p.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
}

function toolLinksWidget(body, size, ctx, app, config) {
  const pages = linkedPages(app, config);
  if (!pages.length) {
    body.append(hint("No links yet. Press Customize, then the gear on this widget, to choose tools."));
    return;
  }
  if (size === "s") {
    body.append(el("div", { class: "widget-tool-icons" }, ...pages.map((page) =>
      el("button", {
        type: "button", class: "widget-tool-icon", title: page.title, "aria-label": page.title,
        onClick: () => app.go(page.id),
      }, icon(page.icon, { size: 20 })))));
    return;
  }
  if (size === "m") {
    body.append(el("div", { class: "tool-link-list" }, ...pages.map((page) =>
      el("button", { type: "button", class: "tool-link", onClick: () => app.go(page.id) },
        el("span", { class: "tool-icon is-small" }, icon(page.icon, { size: 16 })),
        el("span", { class: "tool-link-title", text: page.title })))));
    return;
  }
  body.append(el("div", { class: "tool-grid" }, ...pages.map((page) =>
    el("button", { type: "button", class: "tool-card", onClick: () => app.go(page.id) },
      el("span", { class: "tool-card-title" },
        el("span", { class: "tool-icon" }, icon(page.icon, { size: 20 })),
        el("span", { class: "tool-link-title", text: page.title })),
      el("span", { class: "hint", text: page.blurb || "" })))));
}

/** Settings: a tick per tool, in sidebar order. */
function toolLinksFields(body, config, app) {
  const chosen = Array.isArray(config.pages) ? new Set(config.pages) : null;
  const boxes = app.toolPages().map((page) => {
    const on = app.toolEnabled(page.key);
    const box = el("input", { type: "checkbox" });
    box.checked = chosen ? chosen.has(page.id) : on;
    return [page.id, box, el("label", { class: `checkbox ${on ? "" : "is-off"}`.trim() }, box,
      el("span", { text: on ? page.title : `${page.title} (switched off in Setup)` }))];
  });
  body.append(el("label", { class: "field-label", text: "Links" }),
    el("div", { class: "settings-checks" }, ...boxes.map(([, , label]) => label)));
  return { value: () => ({ pages: boxes.filter(([, box]) => box.checked).map(([id]) => id) }) };
}

/**
 * The catalogue, in default order. `tool` is the Setup switch a widget
 * belongs to (hidden while that tool is off); `needsBudget` hides it until
 * a budget is loaded; `go`/`tab` is where its Open link leads. Every
 * widget's settings have a title; `fields` adds its own options to that
 * dialog, and `titleFor` names it from them when no title is set. A
 * `multi` widget can be added more than once, each copy set up apart.
 */
export const WIDGETS = [
  {
    id: "rta", title: "Ready to Assign", icon: "chart", tool: "budgetOverview", go: "budget",
    blurb: "This month's Ready to Assign, and what was assigned, spent and earned.",
    sizes: ["s", "m", "l"], defaultSize: "s", byDefault: true, needsBudget: true, render: readyToAssignWidget,
  },
  {
    id: "overspent", title: "Overspent", icon: "x", tool: "budgetOverview", go: "budget",
    blurb: "Categories below zero this month.",
    sizes: ["s", "m", "l"], defaultSize: "s", byDefault: true, needsBudget: true, render: overspentWidget,
  },
  {
    id: "review", title: "To review", icon: "check", tool: "categorize", go: "categorize",
    blurb: "Transactions with no category or not approved yet.",
    sizes: ["s", "m", "l"], defaultSize: "s", byDefault: true, needsBudget: true, render: reviewWidget,
  },
  {
    id: "recurring", title: "Subscriptions", icon: "pulse", tool: "reports", go: "reports", tab: "recurring",
    blurb: "What your regular charges cost a month, and any that went up or are new.",
    sizes: ["s", "m", "l"], defaultSize: "s", byDefault: true, needsBudget: true, render: recurringWidget,
  },
  {
    id: "categoryChart", title: "Spending chart", icon: "chart", tool: null, go: "reports", tab: "trends",
    blurb: "Month-by-month spending in the categories or groups you choose. Add as many as you like.",
    sizes: ["s", "m", "l"], defaultSize: "l", byDefault: true, needsBudget: true, multi: true,
    defaultConfig: { all: true, separate: true },
    titleFor: (config, app) => selectionName(config, app.state.categoryGroups) || "Spending chart",
    fields: categoryChartFields, wideSettings: true,
    render: categoryChartWidget,
  },
  {
    id: "attention", title: "Needs attention", icon: "info", tool: null, go: null,
    blurb: "Every tool's warnings in one list, most urgent first.",
    sizes: ["s", "m", "l"], defaultSize: "l", byDefault: true, needsBudget: true, render: attentionWidget,
  },
  {
    id: "upcoming", title: "Upcoming bills", icon: "calendar", tool: "upcoming", go: "upcoming",
    blurb: "What is due soon, and whether your accounts cover it.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: upcomingWidget,
    fields: (body, config) => {
      const days = select([
        { value: "7", label: "The next 7 days" },
        { value: "14", label: "The next 14 days" },
        { value: "30", label: "The next 30 days" },
      ], String(config.days || 7), () => {});
      body.append(el("label", { class: "field-label", text: "Look ahead" }), days);
      return { value: () => ({ days: Number(days.value) }) };
    },
  },
  {
    id: "forecast", title: "Cash forecast", icon: "trend", tool: "upcoming", go: "upcoming",
    blurb: "Each account's balance over the next 30 days, as a chart.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: forecastWidget,
    fields: accountFields((a) => a.on_budget !== false && CASH_TYPES.has(a.type)),
  },
  {
    id: "spending", title: "Spending this month", icon: "trend", tool: null, go: "reports", tab: "spending",
    blurb: "Spent so far against the same point last month, by category.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: spendingWidget,
  },
  {
    id: "cashflow", title: "Cash flow", icon: "fill", tool: "reports", go: "reports", tab: "cashflow",
    blurb: "Income against spending month by month, as a chart, and what was left over.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: cashFlowWidget,
  },
  {
    id: "accounts", title: "Accounts", icon: "wallet", tool: null, go: "budget",
    blurb: "Cash on hand, card balances and net worth.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: accountsWidget,
    fields: accountFields(() => true),
  },
  {
    id: "settle", title: "Settle up", icon: "split", tool: "splitSheet", go: "splitsheet",
    blurb: "Whether each Bill Splitting cycle has been paid.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: true, render: settleWidget,
  },
  {
    id: "toolLinks", title: "Tool links", icon: "layout", tool: null, go: null,
    blurb: "Shortcuts to the tools you choose. Add more than one to group them.",
    sizes: ["s", "m", "l"], defaultSize: "m", byDefault: true, needsBudget: false, multi: true,
    defaultConfig: {}, fields: toolLinksFields, render: toolLinksWidget,
  },
];

/** Whether a widget can show right now: its tool on, its data there. */
export function widgetAvailable(widget, app) {
  if (widget.tool && !app.toolEnabled(widget.tool)) return false;
  if (widget.needsBudget && !(app.state.token && app.state.budgetId && app.state.hasBudgetData)) return false;
  return true;
}

/** Draw one widget's content into `body`, with a message instead of an error. */
export async function drawWidget(widget, body, size, ctx, app, config) {
  clear(body).append(hint("Loading..."));
  const content = el("div", { class: "widget-content" });
  try {
    await widget.render(content, size, ctx, app, config);
    clear(body).append(content);
  } catch (error) {
    clear(body).append(hint(`Could not load this: ${error.shortMessage || error.message}`));
  }
}
