// For your spending (at explicit user request, 2026-11-16: "best card for
// your spending"): your real yearly card spending from YNAB, sorted into
// Card Rewards' purchase types, then what your own cards earn on it used
// at their best, and which other cards would add the most after their fee.

import { CARDS, NETWORKS } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue, useSavedCatalogue } from "../tools/card_feed.js";
import { purchaseLabel, shortName, walletCards } from "../tools/card_rewards.js";
import { bestOfSet, cardsToAdd, spendByPurchase, spendGroups, spendItems } from "../tools/card_spending.js";
import { readyToAssignCategoryIds } from "../tools/rta_tracker.js";
import { button, card, clear, el, emptyRow, hint, pageHeading, pill, sectionTitle, select, table } from "../ui.js";

const SOURCES = [
  { value: "cards", label: "Credit card accounts" },
  { value: "all", label: "Every account in the budget" },
];

export function cardSpendingPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("cardRewards");
  if (!Array.isArray(settings.wallet)) settings.wallet = [];
  if (!SOURCES.some((s) => s.value === settings.spendFrom)) settings.spendFrom = "cards";

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Spending",
    "Your last 12 months of spending from YNAB, sorted into the card categories, then what " +
    "your own cards earn on it if each purchase goes on the best one, and which other cards " +
    "would add the most a year after their annual fee. Estimates at your point values."));

  const from = select(SOURCES, settings.spendFrom, (value) => {
    settings.spendFrom = value;
    store.save();
    build();
  });
  from.setAttribute("aria-label", "Spending from");
  const controls = el("div", { class: "card spend-controls" },
    el("label", { class: "spend-from" }, el("span", { class: "field-label", text: "Spending from" }), from));
  const host = el("div", { class: "spend-results" });
  root.append(controls, host);

  const dollars = (n) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-CA")}`;
  const pct = (n) => `${Number(n.toFixed(2))}%`;
  let list = null;

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function load() {
    if (!(state.token && state.budgetId && state.hasBudgetData)) {
      clear(host).append(card(hint("Connect to YNAB in Settings first: this works from your own spending.")));
      return;
    }
    clear(host).append(card(hint("Adding up your last 12 months...")));
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    try {
      list = { since: isoDate(start), until: isoDate(new Date()), transactions: (await state.transactions(isoDate(start))).list };
    } catch (error) {
      clear(host).append(card(hint(`Could not load your transactions: ${error.shortMessage || error.message}`)));
      return;
    }
    build();
  }

  function build() {
    if (!list) return;
    clear(host);
    if (!CARDS.length) {
      host.append(card(hint("Getting the latest card details...")));
      return;
    }
    const accounts = (state.accounts || []).filter((a) => !a.deleted && a.on_budget !== false &&
      (settings.spendFrom === "all" || a.type === "creditCard" || a.type === "lineOfCredit"));
    const names = new Map(state.flatCategories(true).map((i) => [i.category.id, i.category.name]));
    const items = spendItems(list.transactions, {
      accountIds: new Set(accounts.map((a) => a.id)), since: list.since, until: list.until,
      categoryName: (id) => names.get(id) || "",
      exclude: readyToAssignCategoryIds(state.categoryGroups),
    });
    const groups = spendGroups(items);
    const total = groups.reduce((n, g) => n + g.amount, 0);
    if (!total) {
      host.append(card(hint(settings.spendFrom === "cards"
        ? "No credit card spending in the last 12 months. Try every account in the budget."
        : "No spending in the last 12 months.")));
      return;
    }
    const held = walletCards(settings.wallet);
    const view = { values: settings.values || {}, preferred: settings.preferred || "" };
    host.append(spendingCard(groups, held, view), yoursCard(groups, held, view, total), addCard(groups, held, view),
      hint("Estimates: shops are sorted by name and YNAB category, and unknown ones use the same " +
        "odds as Best card. Sign-up bonuses, first-year fee waivers and credits are not " +
        "counted; see Bonuses for those."));
  }

  // Each category's spending, and which of your cards does best on it.
  function spendingCard(groups, held, view) {
    const wrap = table([
      { key: "what", label: "Category" },
      { key: "spent", label: "A year", className: "num" },
      { key: "best", label: held.length ? "Best of yours" : "" },
      { key: "back", label: held.length ? "Back" : "", className: "num" },
    ]);
    const rows = spendByPurchase(groups.map((g) => ({ ...g, date: "" })));
    if (!rows.length) emptyRow(wrap, "Nothing spent.");
    for (const row of rows) {
      let best = "";
      let back = "";
      if (held.length) {
        const result = bestOfSet(held, groups.filter((g) => g.purchase === row.purchase), view);
        const top = [...result.perCard].sort((a, b) => b.spend - a.spend)[0];
        best = top?.spend > 0 ? shortName(top.card) : "None accepted";
        back = result.earned > 0 ? pct(result.earned / row.amount * 100) : "";
      }
      wrap.tbody.append(el("tr", {},
        el("td", { text: purchaseLabel(row.purchase) }),
        el("td", { class: "num", text: dollars(row.amount) }),
        el("td", { text: best }),
        el("td", { class: "num", text: back })));
    }
    return el("div", { class: "card" }, sectionTitle("Your spending, last 12 months"), wrap);
  }

  // Your own cards, each purchase on the best of them.
  function yoursCard(groups, held, view, total) {
    if (!held.length) {
      return card(sectionTitle("Your cards"),
        hint("Add the cards you carry on Wallet to see what they earn on this."),
        button("Go to Wallet", { small: true, onClick: () => app.go("mycards") }));
    }
    const result = bestOfSet(held, groups, view);
    return el("div", { class: "card" },
      sectionTitle("Your cards, used at their best"),
      el("p", { class: "spend-headline" },
        `About ${dollars(result.earned)} a year back on ${dollars(total)} of spending ` +
        `(${pct(result.earned / total * 100)})` +
        (result.fees ? `, less ${dollars(result.fees)} in fees: ${dollars(result.net)} a year.` : ".")),
      el("ul", { class: "spend-list" }, result.perCard
        .filter((r) => r.spend > 0)
        .sort((a, b) => b.earned - a.earned)
        .map((r) => el("li", {},
          el("span", { class: "spend-name", text: shortName(r.card) }),
          el("span", { class: "hint", text: `${dollars(r.spend)} of spending, ${dollars(r.earned)} back` })))),
      result.perCard.some((r) => r.spend <= 0)
        ? hint(`Never the best here: ${result.perCard.filter((r) => r.spend <= 0).map((r) => shortName(r.card)).join(", ")}.`)
        : "");
  }

  // Other cards, by what they would add after their fee.
  function addCard(groups, held, view) {
    const ranked = cardsToAdd(held, CARDS, groups, { ...view, limit: 8 }).filter((r) => r.gain > 0).slice(0, 5);
    const title = held.length ? "Cards that would add the most" : "Best cards for your spending";
    if (!ranked.length) {
      return card(sectionTitle(title), hint("None of the cards in the list would add more than its annual fee."));
    }
    return el("div", { class: "card" },
      sectionTitle(title),
      el("ol", { class: "spend-add" }, ranked.map((r) => el("li", {},
        el("div", { class: "spend-add-head" },
          el("span", { class: "spend-name", text: r.card.name }),
          pill(`+${dollars(r.gain)} a year`, "ok")),
        el("div", { class: "hint", text: [
          NETWORKS[r.card.network] || r.card.network,
          r.fee ? `${dollars(r.fee)} fee` : "no fee",
          held.length
            ? `adds ${dollars(r.extra)} back by taking ${dollars(r.spend)} of your spending`
            : `${dollars(r.extra)} back a year`,
        ].join(" · ") })))));
  }

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  // The saved copy at once, then the latest whenever the page opens (at
  // most every FEED_MAX_AGE_MS, so hopping between the card tabs is free).
  useSavedCatalogue(storage);
  load();
  loadCatalogue({ fetchJson: browserFetchJson, storage }).then(build);
  return root;
}
