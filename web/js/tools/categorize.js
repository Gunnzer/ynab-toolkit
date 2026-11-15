// Categorize and approve: transactions waiting on you in YNAB, with a
// category suggested from how you have categorized that payee before.
//
// Read-only here; the page does the writing, one bulk update, with a
// backup of what each transaction was so it can be put back.

import { merchantInPayee } from "./merchants.js";
import { normalizePayee } from "./recurring.js";

/**
 * The ids that mean "no category yet": YNAB writes some uncategorized
 * transactions as a null category and others as its own internal
 * "Uncategorized" category, depending on where they came from.
 */
export function uncategorizedIds(categoryGroups) {
  const ids = new Set();
  for (const group of categoryGroups || []) {
    if (group.name !== "Internal Master Category") continue;
    for (const category of group.categories || []) {
      if (category.name === "Uncategorized") ids.add(category.id);
    }
  }
  return ids;
}

/**
 * Tracking (off-budget) accounts, closed ones included. YNAB never lets a
 * transaction there carry a category, so they are left out of review
 * entirely - at explicit user request, after a closed TFSA's balance
 * adjustment showed up as "no category".
 */
export function offBudgetAccountIds(accounts) {
  return new Set((accounts || []).filter((a) => a.on_budget === false).map((a) => a.id));
}

function isUncategorized(categoryId, uncategorized) {
  return !categoryId || uncategorized.has(categoryId);
}

/**
 * Per payee, how often each category was used - from approved,
 * categorized, single-category transactions only (a split's legs are
 * several answers to one question, and an unapproved one is not your
 * answer yet).
 */
export function payeeHistory(transactions, { uncategorized = new Set(), exclude = new Set() } = {}) {
  const history = new Map();
  for (const t of transactions || []) {
    if (t.deleted || t.approved === false || t.transfer_account_id) continue;
    if ((t.subtransactions || []).some((s) => !s.deleted)) continue;
    if (isUncategorized(t.category_id, uncategorized) || exclude.has(t.category_id)) continue;
    const key = normalizePayee(t.payee_name);
    if (!key) continue;
    const counts = history.get(key) || new Map();
    counts.set(t.category_id, (counts.get(t.category_id) || 0) + 1);
    history.set(key, counts);
  }
  return history;
}

/**
 * The category most often used for this payee, with how sure it is:
 * "strong" when it was used at least twice and for at least 80% of that
 * payee's transactions, otherwise "weak".
 */
export function suggestCategory(payeeName, history) {
  const counts = history.get(normalizePayee(payeeName));
  if (!counts) return null;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const [categoryId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    categoryId,
    count,
    total,
    strength: count >= 2 && count / total >= 0.8 ? "strong" : "weak",
  };
}

// What kind of shop a payee is, for one you have never categorized before
// (at explicit user request: "if it's food to already choose a category").
// A listed shop first (merchants.js), then words in the name. "Everything
// else" shops (Walmart, Costco, Amazon) are no help here: what was bought
// decides their category, not the shop.
const KIND_WORDS = [
  ["dining", ["restaurant", "resto", "cafe", "coffee", "pizza", "pizzeria", "sushi", "grill", "bistro", "pub",
    "kitchen", "burger", "burgers", "taco", "tacos", "pho", "ramen", "bakery", "diner", "eatery", "shawarma",
    "noodle", "noodles", "brewery", "brewing", "bbq", "wings", "poutine", "cuisine", "trattoria", "taqueria",
    "izakaya", "dumpling", "dumplings", "brasserie", "boulangerie", "patisserie", "creperie", "smokehouse"]],
  ["groceries", ["grocery", "grocer", "groceries", "supermarket", "supermarche", "epicerie", "butcher", "boucherie",
    "fruiterie", "fresh market", "farmers market"]],
  ["gas", ["gas bar", "gas station", "fuel", "fuels", "petroleum"]],
  ["parking", ["parking", "impark"]],
  ["drugstore", ["pharmacy", "pharmacie", "drug mart", "drugstore"]],
  ["transit", ["transit", "presto", "taxi", "cab co"]],
  ["wellness", ["gym", "fitness", "yoga", "spa", "massage", "physio"]],
  ["entertainment", ["cinema", "cinemas", "theatre", "theater", "tickets"]],
];

/** Plain words for each kind, for notes ("you usually use X for restaurants"). */
export const KIND_LABELS = {
  groceries: "groceries", dining: "restaurants and coffee", delivery: "food delivery", gas: "gas",
  ev: "EV charging", transit: "transit and rides", parking: "parking", streaming: "streaming",
  digital: "apps and games", bills: "bills", drugstore: "drugstores", wellness: "gyms and spas",
  entertainment: "entertainment", travel: "travel", hotels: "hotels", homeimprovement: "home improvement",
  furniture: "furniture",
};

// Listed as a grocer for card rewards, but one trip can be groceries,
// household, clothes and gas, so the shop says nothing about the category.
const MIXED_SHOPS = new Set(["Costco"]);

const kindCache = new Map();

/** { kind, shop } for a payee, or null. `shop` is the listed shop's name, if any. */
export function payeeKind(payeeName) {
  const key = String(payeeName || "").toLowerCase();
  if (!key) return null;
  if (kindCache.has(key)) return kindCache.get(key);
  let found = null;
  const merchant = merchantInPayee(payeeName);
  if (merchant) {
    if (merchant.purchase !== "other" && !MIXED_SHOPS.has(merchant.name)) {
      found = { kind: merchant.purchase, shop: merchant.name };
    }
  } else {
    const words = ` ${key.replace(/[^a-z0-9]+/g, " ").trim()} `;
    for (const [kind, list] of KIND_WORDS) {
      if (list.some((word) => words.includes(` ${word} `))) {
        found = { kind, shop: null };
        break;
      }
    }
  }
  kindCache.set(key, found);
  return found;
}

/**
 * Per kind of shop, which categories you use: overall and per account (so
 * a person's own card leans to their own category when categories are
 * split by person). Same rules as payeeHistory() for what counts.
 */
export function kindHistory(transactions, { uncategorized = new Set() } = {}) {
  const kinds = new Map();
  for (const t of transactions || []) {
    if (t.deleted || t.approved === false || t.transfer_account_id) continue;
    if ((t.subtransactions || []).some((s) => !s.deleted)) continue;
    if (isUncategorized(t.category_id, uncategorized)) continue;
    const found = payeeKind(t.payee_name);
    if (!found) continue;
    const entry = kinds.get(found.kind) || { all: new Map(), byAccount: new Map() };
    entry.all.set(t.category_id, (entry.all.get(t.category_id) || 0) + 1);
    const own = entry.byAccount.get(t.account_id) || new Map();
    own.set(t.category_id, (own.get(t.category_id) || 0) + 1);
    entry.byAccount.set(t.account_id, own);
    kinds.set(found.kind, entry);
  }
  return kinds;
}

/**
 * A category for a payee you have never categorized, from what you use for
 * that kind of shop: that account's own habit when it has at least two,
 * else everyone's. "strong" (ticked) when used at least 3 times and for 80%
 * of that kind. With no history for the kind, categoryId is null but the
 * kind is still given, so the page can say what it looks like.
 */
export function suggestByKind(transaction, kinds) {
  const found = payeeKind(transaction.payee_name);
  if (!found) return null;
  const entry = kinds?.get(found.kind);
  const own = entry?.byAccount.get(transaction.account_id);
  const ownTotal = own ? [...own.values()].reduce((a, b) => a + b, 0) : 0;
  const counts = ownTotal >= 2 ? own : entry?.all;
  if (!counts?.size) return { categoryId: null, count: 0, total: 0, strength: "weak", ...found, source: "kind" };
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const [categoryId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    categoryId, count, total,
    strength: count >= 3 && count / total >= 0.8 ? "strong" : "weak",
    ...found,
    source: "kind",
  };
}

/**
 * The last time each payee was split, as shares of the total, so the same
 * split can be offered again (a Costco run split groceries and household).
 */
export function splitHistory(transactions) {
  const latest = new Map();
  for (const t of transactions || []) {
    if (t.deleted || t.approved === false || !t.amount) continue;
    const legs = (t.subtransactions || []).filter((s) => !s.deleted && s.category_id);
    if (legs.length < 2) continue;
    const key = normalizePayee(t.payee_name);
    if (!key) continue;
    const seen = latest.get(key);
    if (seen && seen.date >= t.date) continue;
    latest.set(key, {
      date: t.date,
      legs: legs.map((s) => ({ categoryId: s.category_id, share: s.amount / t.amount, memo: s.memo || "" })),
    });
  }
  return latest;
}

/**
 * Amounts for each share of a total, in whole cents, the last one taking
 * whatever rounding leaves so they always add up exactly.
 */
export function splitByShares(total, shares) {
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const amounts = [];
  let left = total;
  shares.forEach((share, i) => {
    if (i === shares.length - 1) amounts.push(left);
    else {
      const amount = Math.round((total * share) / sum / 10) * 10;
      amounts.push(amount);
      left -= amount;
    }
  });
  return amounts;
}

/**
 * Each person's own version of a category, for a shared split taken from
 * Settings (at explicit user request: "can't it take the split from the
 * settings?"): the category with the same name in a group that person
 * owns, the way a budget split by person is usually built ("Alex: Groceries"
 * and "Sam: Groceries"). A category that is already one person's stays
 * theirs. The people's own names are ignored when comparing, so "Groceries
 * (Alex)" and "Groceries (Sam)" match too. null where nothing matches.
 *   categories: [{ id, name, owner: "p1" | "p2" | "shared" }]
 */
export function personCategories(categoryId, categories, { names = [] } = {}) {
  const drop = names.map((name) => plainName(name)).filter(Boolean);
  const base = (name) => {
    let text = ` ${plainName(name)} `;
    for (const word of drop) text = text.split(` ${word} `).join(" ");
    return text.replace(/\s+/g, " ").trim();
  };
  const start = (categories || []).find((c) => c.id === categoryId);
  if (!start) return { p1: null, p2: null };
  const key = base(start.name);
  const pick = (owner) => (start.owner === owner ? start.id
    : (categories.find((c) => c.owner === owner && base(c.name) === key)?.id || null));
  return { p1: pick("p1"), p2: pick("p2") };
}

function plainName(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\p{Extended_Pictographic}|[\uFE0E\uFE0F\u200D]/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** What is wrong with a split, or "" when it can be saved. */
export function splitProblem(total, legs) {
  if (!legs || legs.length < 2) return "A split needs at least two parts.";
  if (legs.some((leg) => !leg.categoryId)) return "Every part needs a category.";
  if (legs.some((leg) => !leg.amount)) return "Every part needs an amount.";
  // A part on the other side of zero would be a refund inside a purchase,
  // which is what typing more than the total into one part produces.
  if (legs.some((leg) => Math.sign(leg.amount) !== Math.sign(total || 1))) {
    return "A part can't be more than the whole amount.";
  }
  const left = total - legs.reduce((a, leg) => a + leg.amount, 0);
  if (left) {
    const short = Math.sign(total || 1) * left > 0;
    return `The parts must add up to the total (${short ? "short" : "over"} by $${(Math.abs(left) / 1000).toFixed(2)}).`;
  }
  return "";
}

/**
 * The body that turns one transaction into a split (YNAB only lets an
 * unsplit transaction be split by update; changing a split later has to be
 * done in YNAB). Same shape as Shared Expenses' splitPayload().
 */
export function splitUpdate(transaction, legs, { memo, approve = true } = {}) {
  const note = memo ?? transaction.memo ?? "";
  return {
    id: transaction.id,
    account_id: transaction.account_id,
    date: transaction.date,
    payee_id: transaction.payee_id ?? null,
    memo: note,
    cleared: transaction.cleared,
    approved: approve ? true : transaction.approved,
    flag_color: transaction.flag_color ?? null,
    category_id: null,
    amount: transaction.amount,
    subtransactions: legs.map((leg) => ({ amount: leg.amount, category_id: leg.categoryId, memo: leg.memo || "" })),
  };
}

/**
 * Everything waiting on you: unapproved, or with no category. Each item:
 *   kind        "normal", "transfer" (no category to set) or "split"
 *               (categories live on the legs - approve only)
 *   needsCategory, needsApproval
 *   suggestion  from payeeHistory(), for a normal one with no category;
 *               `usable: false` when it is a category the picker cannot
 *               show (`pickable`, e.g. Ready to Assign or a hidden one)
 *   categoryId  what it would be saved as: its own category if it has
 *               one (YNAB often guesses on import), else a usable
 *               suggestion. Never an unusable one - that would save a
 *               category the screen never showed (a real bug: a balance
 *               adjustment's "suggestion" was Ready to Assign).
 * Transactions on `offBudget` accounts are left out. Newest first.
 */
export function reviewQueue(transactions, {
  history, kinds = null, splits = null, uncategorized = new Set(), offBudget = new Set(), pickable = null,
}) {
  const items = [];
  for (const t of transactions || []) {
    if (t.deleted || offBudget.has(t.account_id)) continue;
    const isSplit = (t.subtransactions || []).some((s) => !s.deleted);
    const kind = t.transfer_account_id ? "transfer" : isSplit ? "split" : "normal";
    const needsCategory = kind === "normal" && isUncategorized(t.category_id, uncategorized);
    const needsApproval = t.approved === false;
    if (!needsCategory && !needsApproval) continue;

    const byKind = needsCategory && kinds ? suggestByKind(t, kinds) : null;
    const found = needsCategory
      ? (suggestCategory(t.payee_name, history) || (byKind?.categoryId ? byKind : null))
      : null;
    const suggestion = found && { ...found, usable: !pickable || pickable.has(found.categoryId) };
    const lastSplit = kind === "normal" ? splits?.get(normalizePayee(t.payee_name)) || null : null;
    items.push({
      transaction: t,
      kind,
      needsCategory,
      needsApproval,
      suggestion,
      // What kind of shop it looks like, even with nothing to suggest yet.
      looksLike: byKind && !found ? byKind : null,
      lastSplit: lastSplit && (!pickable || lastSplit.legs.every((leg) => pickable.has(leg.categoryId)))
        ? lastSplit : null,
      categoryId: needsCategory
        ? (suggestion?.usable ? suggestion.categoryId : null)
        : (t.category_id || null),
    });
  }
  return items.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
}

/**
 * The bulk update for the chosen items, plus a backup of each one's
 * category, approval and note beforehand, and a separate list of splits
 * (each its own update, with no undo here). A transfer or split only ever gets
 * approved - its category is not ours to set. An item still with no
 * category is approved as uncategorized only if `approveUncategorized`.
 */
export function buildUpdate(items, { approveUncategorized = false } = {}) {
  const updates = [];
  const backup = [];
  const splits = [];
  for (const item of items) {
    const t = item.transaction;
    if (item.kind === "normal" && item.split) {
      splits.push(splitUpdate(t, item.split, { memo: item.memo }));
      continue;
    }
    const change = { id: t.id };
    if (item.memo !== undefined && item.memo !== (t.memo || "")) change.memo = item.memo;
    if (item.kind === "normal" && item.categoryId && item.categoryId !== t.category_id) {
      change.category_id = item.categoryId;
    }
    if (item.kind !== "normal" || item.categoryId || approveUncategorized) {
      if (t.approved === false) change.approved = true;
    }
    if (Object.keys(change).length === 1) continue;
    updates.push(change);
    backup.push({
      id: t.id,
      date: t.date,
      payee: t.payee_name || "",
      amount: t.amount || 0,
      category_id: t.category_id ?? null,
      approved: t.approved !== false,
      memo: t.memo || "",
    });
  }
  return { updates, backup, splits };
}

/**
 * The update that puts backed-up transactions back how they were. Splits
 * are not in it: YNAB will not un-split by update.
 */
export function undoUpdate(backup) {
  return (backup || []).map((b) => ({
    id: b.id, category_id: b.category_id, approved: b.approved,
    ...(b.memo !== undefined ? { memo: b.memo } : {}),
  }));
}
