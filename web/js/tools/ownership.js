// Whose is it: one person's, the other's, or shared - for the "Whose"
// choice on Home and in Reports. Pure, so both pages answer the question
// exactly the same way and their numbers always agree.
//
// The rules are the app's usual ones: a category by its group's person
// prefix (ownerOf()), an account by its tag or name (payerOf(), where
// "shared" means a joint account), and a transaction by its category - or
// by its account when it has none of its own.

import { ownerOf, payerOf } from "./split_sheet.js";

// YNAB's own groups have no person prefix, so ownerOf() would call them
// "shared" - which once put the whole budget's income into Shared's
// spending. Anything in them goes by its account instead.
const NOT_OWNED = new Set(["Internal Master Category", "Credit Card Payments"]);

/**
 * `owner` is "all", "p1", "p2" or "shared". `people` is state.withPeople({})
 * (names, group prefixes, tags), `accountOwners` Bill Splitting's explicit
 * account mapping, `accountNameOf(id)` an account's name.
 */
export function ownership({ owner = "all", categoryGroups = [], people = {}, accountOwners = {}, accountNameOf = () => "" }) {
  const everyone = !owner || owner === "all";
  const groupOf = new Map();
  for (const group of categoryGroups) {
    for (const category of group.categories || []) groupOf.set(category.id, group.name);
  }
  const accountSettings = { ...people, accountOwners };

  const ownCategory = (id) => Boolean(id) && groupOf.has(id) && !NOT_OWNED.has(groupOf.get(id));
  const categoryMine = (id) => everyone || ownerOf(groupOf.get(id) || "", "", people) === owner;
  const accountMine = (id) => everyone ||
    payerOf(accountNameOf(id), accountSettings) === (owner === "shared" ? "joint" : owner);
  const itemMine = (categoryId, accountId) => everyone ||
    (ownCategory(categoryId) ? categoryMine(categoryId) : accountMine(accountId));

  const liveLegs = (t) => (t.subtransactions || []).filter((leg) => !leg.deleted);

  /** A transaction is this person's if any of it is. */
  const transactionMine = (t) => {
    if (everyone) return true;
    const legs = liveLegs(t);
    if (legs.length) return legs.some((leg) => itemMine(leg.category_id, t.account_id));
    return itemMine(t.category_id, t.account_id);
  };

  /**
   * How much of an amount is this person's, 0 to 1. A split is shared out
   * leg by leg (a $200 grocery run split $100 / $100 is half each); a
   * charge with no category of its own can borrow `fallbackCategory`.
   */
  const shareOf = (legs, categoryId, accountId, fallbackCategory = null) => {
    if (everyone) return 1;
    const live = (legs || []).filter((leg) => !leg.deleted);
    if (!live.length) {
      const category = ownCategory(categoryId) ? categoryId : fallbackCategory;
      return itemMine(category, accountId) ? 1 : 0;
    }
    const size = (leg) => Math.abs(leg.amount || 0);
    const total = live.reduce((sum, leg) => sum + size(leg), 0);
    if (!total) return 0;
    const legCategory = (leg) => leg.category_id ?? leg.categoryId;
    return live.filter((leg) => itemMine(legCategory(leg), accountId)).reduce((sum, leg) => sum + size(leg), 0) / total;
  };

  return { owner, everyone, ownCategory, categoryMine, accountMine, itemMine, transactionMine, shareOf };
}

/**
 * This person's share of a recurring charge, across all of its charges and
 * weighted by amount. A charge with no category of its own counts as the
 * series' usual category: going by the latest charge alone, a
 * still-uncategorized latest SHELL charge on one person's card handed a
 * whole shared Gas series to them.
 */
export function recurringShare(item, byId, own) {
  if (own.everyone) return 1;
  let mine = 0;
  let total = 0;
  for (const id of item.transactionIds || []) {
    const t = byId.get(id);
    if (!t) continue;
    const size = Math.abs(t.amount || 0);
    mine += own.shareOf(t.subtransactions, t.category_id, t.account_id, item.categoryId) * size;
    total += size;
  }
  return total ? mine / total : 0;
}

/** A recurring charge cut down to a share of it; `share` and `fullTypical` say how. */
export function scaleRecurring(item, share) {
  if (share === 1) return item;
  const scale = (amount) => Math.round(amount * share);
  return {
    ...item,
    share,
    fullTypical: item.typical,
    typical: scale(item.typical),
    usual: scale(item.usual),
    latest: scale(item.latest),
    yearly: scale(item.yearly),
    priceUp: item.priceUp ? { from: scale(item.priceUp.from), to: scale(item.priceUp.to) } : null,
  };
}

/** findRecurring()'s results for this person: their share of each, none of the ones not theirs. */
export function personRecurring(found, transactions, own) {
  if (own.everyone) return found;
  const byId = new Map((transactions || []).map((t) => [t.id, t]));
  return found.map((item) => scaleRecurring(item, recurringShare(item, byId, own)))
    .filter((item) => item.share !== 0);
}

/**
 * Just this person's part of every transaction: their own legs of a split,
 * their categorized transactions, and nothing in YNAB's own categories
 * (income is not anyone's in particular). Shaped like real transactions,
 * so the usual tools (cashFlow, spendingByMonth) read them unchanged.
 */
export function personTransactions(transactions, own) {
  if (own.everyone) return transactions;
  const out = [];
  for (const t of transactions || []) {
    if (t.deleted) continue;
    const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
    if (legs.length) {
      const kept = legs.filter((leg) => own.ownCategory(leg.category_id) && own.categoryMine(leg.category_id));
      if (kept.length) out.push({ ...t, amount: kept.reduce((sum, leg) => sum + (leg.amount || 0), 0), subtransactions: kept });
    } else if (own.ownCategory(t.category_id) && own.categoryMine(t.category_id)) {
      out.push(t);
    }
  }
  return out;
}
