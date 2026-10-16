// Categorize and approve: transactions waiting on you in YNAB, with a
// category suggested from how you have categorized that payee before.
//
// Read-only here; the page does the writing, one bulk update, with a
// backup of what each transaction was so it can be put back.

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
  history, uncategorized = new Set(), offBudget = new Set(), pickable = null,
}) {
  const items = [];
  for (const t of transactions || []) {
    if (t.deleted || offBudget.has(t.account_id)) continue;
    const isSplit = (t.subtransactions || []).some((s) => !s.deleted);
    const kind = t.transfer_account_id ? "transfer" : isSplit ? "split" : "normal";
    const needsCategory = kind === "normal" && isUncategorized(t.category_id, uncategorized);
    const needsApproval = t.approved === false;
    if (!needsCategory && !needsApproval) continue;

    const found = needsCategory ? suggestCategory(t.payee_name, history) : null;
    const suggestion = found && { ...found, usable: !pickable || pickable.has(found.categoryId) };
    items.push({
      transaction: t,
      kind,
      needsCategory,
      needsApproval,
      suggestion,
      categoryId: needsCategory
        ? (suggestion?.usable ? suggestion.categoryId : null)
        : (t.category_id || null),
    });
  }
  return items.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date));
}

/**
 * The bulk update for the chosen items, plus a backup of each one's
 * category and approval beforehand. A transfer or split only ever gets
 * approved - its category is not ours to set. An item still with no
 * category is approved as uncategorized only if `approveUncategorized`.
 */
export function buildUpdate(items, { approveUncategorized = false } = {}) {
  const updates = [];
  const backup = [];
  for (const item of items) {
    const t = item.transaction;
    const change = { id: t.id };
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
    });
  }
  return { updates, backup };
}

/** The update that puts backed-up transactions back how they were. */
export function undoUpdate(backup) {
  return (backup || []).map((b) => ({ id: b.id, category_id: b.category_id, approved: b.approved }));
}
