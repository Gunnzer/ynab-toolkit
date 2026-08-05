// Auto Assign: drain a holding category into targeted categories.
//
// Walks the chosen category groups in priority order, and each category in
// YNAB's own sort order, topping each up to what it still needs until the
// holding category runs dry.

import { fmt } from "../money.js";

export const BASIS_UNDERFUNDED = "underfunded";
export const BASIS_TARGET = "target_minus_assigned";

export function hasTarget(category) {
  return Boolean(
    category.goal_type !== null && category.goal_type !== undefined
      ? true
      : category.goal_target || category.target_amount
  );
}

/**
 * How many milliunits a category still wants this month.
 *
 * "underfunded" uses YNAB's own goal_under_funded, which already accounts
 * for goal cadence, due dates and rollover. "target_minus_assigned" is the
 * plainer arithmetic the original script used.
 */
export function neededFor(category, basis = BASIS_UNDERFUNDED) {
  const budgeted = category.budgeted || 0;

  if (basis === BASIS_UNDERFUNDED) {
    const under = category.goal_under_funded;
    if (under !== null && under !== undefined) return Math.max(0, Math.trunc(under));
  }

  const target = category.goal_target ?? category.target_amount;
  if (target === null || target === undefined) return 0;
  return Math.max(0, Math.trunc(target) - Math.trunc(budgeted));
}

/** Work out what to assign where. Performs no writes. */
export function buildPlan(monthCategories, groupIds, holdingCategoryId, {
  basis = BASIS_UNDERFUNDED, groupNamesById = {}, includeHidden = false,
} = {}) {
  const byId = new Map(monthCategories.map((c) => [c.id, c]));
  const holding = byId.get(holdingCategoryId);

  if (!holding) {
    return {
      allocations: [], holdingAvailable: 0, holdingBudgeted: 0,
      totalAllocated: 0, remaining: 0, holdingNewBudgeted: 0, considered: 0,
      reason: "The holding category was not found in this month's budget.",
    };
  }

  const holdingAvailable = holding.balance || 0;
  const holdingBudgeted = holding.budgeted || 0;

  if (holdingAvailable <= 0) {
    return {
      allocations: [], holdingAvailable, holdingBudgeted, totalAllocated: 0,
      remaining: holdingAvailable, holdingNewBudgeted: holdingBudgeted,
      considered: 0, reason: "Holding category is empty. Nothing to allocate.",
    };
  }

  const priority = new Map(groupIds.map((id, index) => [id, index]));

  const eligible = monthCategories.filter(
    (c) =>
      priority.has(c.category_group_id) &&
      c.id !== holdingCategoryId &&
      !c.deleted &&
      (includeHidden || !c.hidden) &&
      hasTarget(c)
  );

  eligible.sort((a, b) => {
    const byGroup =
      priority.get(a.category_group_id) - priority.get(b.category_group_id);
    return byGroup !== 0 ? byGroup : (a.sort_order || 0) - (b.sort_order || 0);
  });

  const allocations = [];
  let remaining = holdingAvailable;

  for (const category of eligible) {
    if (remaining <= 0) break;
    const needed = neededFor(category, basis);
    if (needed <= 0) continue;

    const amount = Math.min(needed, remaining);
    allocations.push({
      categoryId: category.id,
      categoryName: category.name,
      groupName: groupNamesById[category.category_group_id] || "",
      currentBudgeted: category.budgeted || 0,
      amount,
      newBudgeted: (category.budgeted || 0) + amount,
    });
    remaining -= amount;
  }

  const totalAllocated = holdingAvailable - remaining;
  return {
    allocations, holdingAvailable, holdingBudgeted, totalAllocated, remaining,
    holdingNewBudgeted: holdingBudgeted - totalAllocated,
    considered: eligible.length,
    reason: allocations.length ? "" : "No categories needed funding.",
  };
}

/** Record the amounts before they change, so the run can be reversed. */
export function makeBackup(month, plan, holdingCategoryId) {
  return {
    month,
    savedAt: new Date().toISOString(),
    holdingCategoryId,
    holdingBudgeted: plan.holdingBudgeted,
    categories: plan.allocations.map((a) => ({
      categoryId: a.categoryId,
      name: a.categoryName,
      budgeted: a.currentBudgeted,
    })),
  };
}

/**
 * Push the plan to YNAB, one category at a time.
 *
 * The holding category is written last: an interrupted run then leaves the
 * holding balance still showing money that has not moved, which is the safe
 * direction to fail in.
 */
export async function applyPlan(client, budgetId, month, plan, holdingCategoryId, {
  log = () => {}, shouldStop = () => false,
} = {}) {
  let applied = 0;
  let failed = 0;
  let moved = 0;

  for (const allocation of plan.allocations) {
    if (shouldStop()) {
      log("Stopped.", "warn");
      break;
    }
    try {
      await client.updateMonthCategory(
        budgetId, month, allocation.categoryId, allocation.newBudgeted);
      applied += 1;
      moved += allocation.amount;
      log(`  +${fmt(allocation.amount)} -> ${allocation.categoryName}`, "ok");
    } catch (error) {
      failed += 1;
      log(`  FAILED ${allocation.categoryName}: ${error.message}`, "error");
    }
  }

  if (moved) {
    const newHolding = plan.holdingBudgeted - moved;
    try {
      await client.updateMonthCategory(
        budgetId, month, holdingCategoryId, newHolding);
      log(`  Holding reduced by ${fmt(moved)}`, "ok");
    } catch (error) {
      failed += 1;
      log(
        `  FAILED to reduce the holding category: ${error.message}\n` +
        `  Set it to ${fmt(newHolding)} manually in YNAB.`, "error");
    }
  }

  return { applied, failed, moved };
}

/** Put every category in a backup back to its previous amount. */
export async function undoFromBackup(client, budgetId, backup, {
  log = () => {}, shouldStop = () => false,
} = {}) {
  if (!backup) {
    log("No Auto Assign backup found for this month.", "warn");
    return { restored: 0, failed: 0 };
  }

  let restored = 0;
  let failed = 0;

  for (const entry of backup.categories || []) {
    if (shouldStop()) {
      log("Stopped.", "warn");
      break;
    }
    try {
      await client.updateMonthCategory(
        budgetId, backup.month, entry.categoryId, entry.budgeted);
      restored += 1;
      log(`  ${entry.name} back to ${fmt(entry.budgeted)}`, "ok");
    } catch (error) {
      failed += 1;
      log(`  FAILED ${entry.name}: ${error.message}`, "error");
    }
  }

  if (backup.holdingCategoryId) {
    try {
      await client.updateMonthCategory(
        budgetId, backup.month, backup.holdingCategoryId, backup.holdingBudgeted);
      log(`  Holding back to ${fmt(backup.holdingBudgeted)}`, "ok");
    } catch (error) {
      failed += 1;
      log(`  FAILED to restore the holding category: ${error.message}`, "error");
    }
  }

  return { restored, failed };
}
