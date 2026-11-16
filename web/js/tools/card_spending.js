// What real spending earns on credit cards (at explicit user request,
// 2026-11-16: "is each card worth its fee", "best card for your spending"
// and caps filled in from YNAB). Every YNAB transaction is sorted into one
// of Card Rewards' purchase types, then valued with the same rules, point
// values and caps as Which card to use. Estimates: a shop that is not
// recognised is valued across the same answer priors the questions use.
//
// DOM-free; tested in tests/card_spending.test.js.

import { QUESTIONS, answerScenarios, asPreferred, capQuestionId, centsPerPoint, earnFor } from "./card_rewards.js";
import { payeeKind } from "./categorize.js";
import { merchantInPayee } from "./merchants.js";

// YNAB category names to purchase types, checked in order (so "Natural
// gas" is a bill before "gas" is fuel, and "Food delivery" is delivery
// before anything else).
const CATEGORY_WORDS = [
  ["delivery", ["delivery", "uber eats", "ubereats", "doordash", "skip the dishes"]],
  ["bills", ["bills", "utilities", "utility", "hydro", "electric", "electricity", "natural gas", "water",
    "internet", "phone", "phones", "cell", "mobile", "wireless", "insurance"]],
  ["groceries", ["grocery", "groceries", "supermarket"]],
  ["dining", ["dining", "restaurant", "restaurants", "eating out", "takeout", "take out", "coffee",
    "cafe", "fast food", "bars", "lunches"]],
  ["ev", ["ev charging", "charging"]],
  ["gas", ["gas", "fuel", "petrol"]],
  ["parking", ["parking"]],
  ["transit", ["transit", "presto", "taxi", "taxis", "rideshare", "uber", "lyft", "commute"]],
  ["streaming", ["streaming", "netflix", "spotify"]],
  ["digital", ["apps", "games", "gaming", "software"]],
  ["drugstore", ["pharmacy", "drugstore", "prescription", "prescriptions", "medication", "medicine"]],
  ["wellness", ["gym", "fitness", "spa", "massage", "wellness", "yoga"]],
  ["entertainment", ["entertainment", "movies", "movie", "concerts", "concert", "events", "tickets"]],
  ["hotels", ["hotel", "hotels", "lodging", "accommodation"]],
  ["travel", ["travel", "flights", "flight", "vacation", "vacations", "trip", "trips", "holiday", "holidays"]],
  ["homeimprovement", ["home improvement", "hardware", "renovation", "renovations", "home maintenance", "home repairs"]],
  ["furniture", ["furniture", "furnishings"]],
];

// What a card company itself charges or credits: not purchases, so they
// neither count as spending nor earn (reported live: a Scotia Momentum showed
// 4.14% back, above its top rate, because its yearly cash back payout was
// read as a 1% refund that took $1,000 or so off "spent").
const NOT_SPENDING = /\b(annual|card|membership) fee\b|^interest\b|\b(purchase|cash advance)? ?interest (charges?|charged)\b|\bpurchase interest\b|\bcash ?back (rewards?|redemption|credit|payout|deposit)\b|\brewards? (redemption|credit)\b|\bpoints? (redemption|credit)\b|\bstatement credit\b|\bfee (rebate|refund|reversal)\b|\bbalance protection\b|\bover ?limit fee\b|\bnsf fee\b/i;

/** Whether a payee is the card company's own charge or credit, not a purchase. */
export function notSpending(payee) {
  return NOT_SPENDING.test(String(payee || ""));
}

/** The purchase type a YNAB category's name points to, or "". */
export function categoryPurchase(name) {
  const words = ` ${String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  if (!words.trim()) return "";
  for (const [purchase, list] of CATEGORY_WORDS) {
    if (list.some((word) => words.includes(` ${word} `))) return purchase;
  }
  return "";
}

/**
 * Which purchase type a transaction is: a listed shop first (which also
 * settles questions like which grocery chain), then words in the payee,
 * then the YNAB category's name, else "other".
 */
export function purchaseOf({ payee = "", category = "" } = {}) {
  const merchant = merchantInPayee(payee);
  if (merchant) return { purchase: merchant.purchase, answers: { ...merchant.answers }, shop: merchant.name, by: "shop" };
  const kind = payeeKind(payee);
  if (kind) return { purchase: kind.kind, answers: {}, shop: null, by: "payee" };
  const fromCategory = categoryPurchase(category);
  if (fromCategory) return { purchase: fromCategory, answers: {}, shop: null, by: "category" };
  return { purchase: "other", answers: {}, shop: null, by: "none" };
}

/**
 * Spending as a list of { date, accountId, amount (dollars, a refund is
 * negative), payee, purchase, answers }. Transfers (card payments) are left
 * out, and so are legs in `exclude` (Ready to Assign: income is not
 * spending). Split transactions count leg by leg.
 */
export function spendItems(transactions, {
  accountIds = null, since = "", until = "9999", categoryName = () => "", exclude = new Set(),
} = {}) {
  const items = [];
  for (const t of transactions || []) {
    if (t.deleted || t.transfer_account_id) continue;
    if (accountIds && !accountIds.has(t.account_id)) continue;
    if (t.date < since || t.date > until) continue;
    const subs = (t.subtransactions || []).filter((s) => !s.deleted);
    for (const leg of subs.length ? subs : [t]) {
      if (leg.transfer_account_id || exclude.has(leg.category_id)) continue;
      const payee = leg.payee_name || t.payee_name || "";
      if (notSpending(payee) || notSpending(leg.memo) || notSpending(t.memo)) continue;
      items.push({
        date: t.date,
        accountId: t.account_id,
        amount: -leg.amount / 1000,
        payee,
        ...purchaseOf({ payee, category: categoryName(leg.category_id) }),
      });
    }
  }
  return items;
}

/** Spending summed per purchase type, biggest first. */
export function spendByPurchase(items) {
  const totals = new Map();
  for (const item of items) totals.set(item.purchase, (totals.get(item.purchase) || 0) + item.amount);
  return [...totals].map(([purchase, amount]) => ({ purchase, amount: round2(amount) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const key = (purchase, answers) => `${purchase}|${JSON.stringify(Object.entries(answers || {}).sort())}`;

/**
 * Card values per dollar for one purchase, scenario by scenario: what the
 * card gives (in dollars per dollar spent) under its cap and past it, and
 * which cap the rule counts against. Cached per card and purchase.
 */
function valuer(values) {
  const cache = new Map();
  return (card, purchase, answers) => {
    const id = `${card.id}|${card.points}|${key(purchase, answers)}`;
    if (cache.has(id)) return cache.get(id);
    const questions = QUESTIONS.filter((q) => q.appliesTo.includes(purchase));
    const cents = centsPerPoint(card.points, values) / 100;
    const table = answerScenarios(questions, purchase, answers).map((s) => {
      const e = earnFor(card, purchase, s.answers, questions);
      if (!e.accepted) return { p: s.p, accepted: false, value: 0, over: 0, cap: null };
      const cap = e.rule?.cap || null;
      const over = cap ? earnFor(card, purchase, { ...s.answers, [capQuestionId(card, cap)]: "over" }, questions).rate : e.rate;
      return { p: s.p, accepted: true, value: e.rate * cents, over: over * cents, cap };
    });
    cache.set(id, table);
    return table;
  };
}

/**
 * What a card earned on its own past spending (it was accepted: it was
 * used), with caps counted in their real months and years. `items` are one
 * account's spendItems().
 */
export function cardEarnings(card, items, { values = {}, preferred = "" } = {}) {
  const [priced] = asPreferred([card], preferred);
  const table = valuer(values);
  const used = new Map();
  const capsHit = new Set();
  const byPurchase = new Map();
  let spend = 0;
  let earned = 0;
  let refunds = 0;
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    if (item.amount < 0) refunds -= item.amount;
    const rows = table(priced, item.purchase, item.answers).filter((r) => r.accepted);
    const pAccepted = rows.reduce((n, r) => n + r.p, 0);
    let value;
    let over;
    let cap = null;
    if (pAccepted > 0) {
      value = rows.reduce((n, r) => n + r.p * r.value, 0) / pAccepted;
      over = rows.reduce((n, r) => n + r.p * r.over, 0) / pAccepted;
      cap = rows.reduce((a, b) => (b.p > a.p ? b : a)).cap;
    } else {
      // It went through on this card, so it was accepted whatever the
      // priors say: the base rate is the honest guess.
      value = over = priced.base * centsPerPoint(priced.points, values) / 100;
    }
    let gain = item.amount * value;
    if (cap && item.amount > 0) {
      const bucket = `${cap.key}|${cap.per === "month" ? item.date.slice(0, 7) : item.date.slice(0, 4)}`;
      const before = used.get(bucket) || 0;
      const room = Math.max(0, cap.spend - before);
      const inside = Math.min(item.amount, room);
      gain = inside * value + (item.amount - inside) * over;
      if (item.amount > room) capsHit.add(cap.label);
      used.set(bucket, before + item.amount);
    }
    spend += item.amount;
    earned += gain;
    const row = byPurchase.get(item.purchase) || { purchase: item.purchase, spend: 0, earned: 0 };
    row.spend += item.amount;
    row.earned += gain;
    byPurchase.set(item.purchase, row);
  }
  const fee = Number(card.annualFee) || 0;
  return {
    spend: round2(spend),
    refunds: round2(refunds),
    earned: round2(earned),
    fee,
    net: round2(earned - fee),
    back: spend > 0 ? earned / spend * 100 : 0,
    capsHit: [...capsHit],
    byPurchase: [...byPurchase.values()]
      .map((r) => ({ ...r, spend: round2(r.spend), earned: round2(r.earned) }))
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.earned - a.earned),
  };
}

/**
 * How much of each of a card's caps is used this month or year, from the
 * card's own spending (Which card to use answers its cap questions with
 * this instead of asking). Keyed by the cap question's id.
 */
export function capUsage(card, items, today, { values = {} } = {}) {
  const table = valuer(values);
  const caps = new Map();
  for (const rule of card.earn || []) if (rule.cap) caps.set(rule.cap.key, rule.cap);
  const result = {};
  for (const cap of caps.values()) {
    const prefix = cap.per === "month" ? today.slice(0, 7) : today.slice(0, 4);
    let used = 0;
    for (const item of items) {
      if (!item.date.startsWith(prefix) || item.date > today) continue;
      const rows = table(card, item.purchase, item.answers).filter((r) => r.accepted);
      if (!rows.length) continue;
      if (rows.reduce((a, b) => (b.p > a.p ? b : a)).cap?.key === cap.key) used += item.amount;
    }
    result[capQuestionId(card, cap)] = {
      value: used >= cap.spend ? "over" : "under",
      used: round2(Math.max(0, used)),
      spend: cap.spend,
      per: cap.per,
      label: cap.label,
    };
  }
  return result;
}

/** spendItems() summed by purchase and known answers, the year's totals. */
export function spendGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const id = key(item.purchase, item.answers);
    const group = groups.get(id) || { purchase: item.purchase, answers: item.answers, amount: 0 };
    group.amount += item.amount;
    groups.set(id, group);
  }
  return [...groups.values()].filter((g) => g.amount > 0);
}

/**
 * What a set of cards earns on a year's spending when every purchase goes
 * on whichever accepted card gives the most. Caps are spread evenly (a
 * monthly cap allows twelve times its spend in a year); spending past a
 * cap earns the card's rate past it. Fees are the cards' annual fees.
 */
export function bestOfSet(cards, groups, { values = {}, preferred = "", table = valuer(values) } = {}) {
  const priced = asPreferred(cards, preferred);
  const perCard = priced.map(() => ({ spend: 0, earned: 0 }));
  const buckets = new Map();
  let total = 0;
  for (const group of groups) {
    const tables = priced.map((card) => table(card, group.purchase, group.answers));
    const count = tables[0]?.length || 0;
    for (let s = 0; s < count; s += 1) {
      let best = -1;
      for (let c = 0; c < priced.length; c += 1) {
        const row = tables[c][s];
        if (row.accepted && (best < 0 || row.value > tables[best][s].value)) best = c;
      }
      if (best < 0) continue;
      const row = tables[best][s];
      const amount = group.amount * row.p;
      total += amount * row.value;
      perCard[best].spend += amount;
      perCard[best].earned += amount * row.value;
      if (row.cap) {
        const id = `${best}|${row.cap.key}`;
        const bucket = buckets.get(id) || { card: best, cap: row.cap, amount: 0, extra: 0 };
        bucket.amount += amount;
        bucket.extra += amount * (row.value - row.over);
        buckets.set(id, bucket);
      }
    }
  }
  for (const bucket of buckets.values()) {
    const allowance = bucket.cap.spend * (bucket.cap.per === "month" ? 12 : 1);
    if (bucket.amount <= allowance) continue;
    const lost = bucket.extra * (bucket.amount - allowance) / bucket.amount;
    total -= lost;
    perCard[bucket.card].earned -= lost;
  }
  const fees = cards.reduce((n, card) => n + (Number(card.annualFee) || 0), 0);
  return {
    earned: round2(total),
    fees,
    net: round2(total - fees),
    perCard: perCard.map((r, i) => ({ card: cards[i], spend: round2(r.spend), earned: round2(r.earned) })),
  };
}

/**
 * Cards not held, by how much more a year's spending would earn with each
 * added to the cards held (used at its best, alongside them), less its
 * annual fee. Best first.
 */
export function cardsToAdd(held, catalogue, groups, { values = {}, preferred = "", limit = 5 } = {}) {
  const table = valuer(values);
  const now = bestOfSet(held, groups, { values, preferred, table });
  const heldIds = new Set(held.map((c) => c.id));
  return catalogue
    .filter((card) => !heldIds.has(card.id))
    .map((card) => {
      const withIt = bestOfSet([...held, card], groups, { values, preferred, table });
      const extra = withIt.earned - now.earned;
      const fee = Number(card.annualFee) || 0;
      const used = withIt.perCard[withIt.perCard.length - 1];
      return { card, extra: round2(extra), fee, gain: round2(extra - fee), spend: used.spend };
    })
    .sort((a, b) => b.gain - a.gain || a.card.name.localeCompare(b.card.name))
    .slice(0, limit);
}
