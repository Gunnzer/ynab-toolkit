// What to leave out of recurring charges (an investment contribution is
// not a subscription) - one setting, `reports.recurringExclude`, shared by
// the Reports Recurring tab and Home's Subscriptions widget, so both always
// show the same list. Upcoming bills and the cash forecast ignore it: the
// money still leaves the account.

import { el, hint } from "../ui.js";
import { assignableCategories } from "./report_kit.js";

export function loadExclude(store) {
  const saved = store.get("reports.recurringExclude", {}) || {};
  return { payees: saved.payees || [], categoryIds: saved.categoryIds || [] };
}

export function saveExclude(store, exclude) {
  store.set("reports.recurringExclude", { payees: exclude.payees, categoryIds: exclude.categoryIds });
}

/** Leave one payee out (from a row's button). */
export function leaveOutPayee(store, key, name) {
  const exclude = loadExclude(store);
  if (!exclude.payees.some((p) => p.key === key)) exclude.payees.push({ key, name });
  saveExclude(store, exclude);
}

/**
 * The settings, for a dialog: categories to leave out (ticked = left out),
 * and the payees already left out (untick to bring one back). Returns
 * `{ value }` giving the new setting; saving is the caller's.
 */
export function excludeFields(body, app) {
  const exclude = loadExclude(app.state.store);
  const chosen = new Set(exclude.categoryIds);
  const categoryBoxes = [];
  const list = el("div", { class: "chart-choices" });
  let lastGroup = null;
  for (const category of assignableCategories(app.state)) {
    if (category.groupName !== lastGroup) {
      lastGroup = category.groupName;
      list.append(el("div", { class: "chart-choice-group", text: lastGroup }));
    }
    const box = el("input", { type: "checkbox" });
    box.checked = chosen.has(category.id);
    categoryBoxes.push([category.id, box]);
    list.append(el("label", { class: "checkbox chart-choice-category" }, box, el("span", { text: category.name })));
  }

  const payeeBoxes = exclude.payees.map((p) => {
    const box = el("input", { type: "checkbox" });
    box.checked = true;
    return [p, box, el("label", { class: "checkbox" }, box, el("span", { text: p.name || p.key }))];
  });

  body.append(
    el("label", { class: "field-label", text: "Leave out whole categories" }),
    hint("For things that repeat but are not bills, like investing or savings. " +
      "Anything in a ticked category is left out, including ones that start later."),
    list,
    el("label", { class: "field-label", text: "Charges left out one by one" }),
    payeeBoxes.length
      ? el("div", { class: "settings-checks" }, ...payeeBoxes.map(([, , label]) => label))
      : hint("None. Use the x on a charge in Reports, Recurring to leave just that one out."),
    hint("Upcoming bills and the cash forecast still count everything - the money still leaves your account."));
  return {
    value: () => ({
      categoryIds: categoryBoxes.filter(([, box]) => box.checked).map(([id]) => id),
      payees: payeeBoxes.filter(([, box]) => box.checked).map(([p]) => p),
    }),
  };
}
