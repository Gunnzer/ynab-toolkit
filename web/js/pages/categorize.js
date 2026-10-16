// Categorize: transactions waiting on you in YNAB - no category yet, or not
// approved - with a category suggested from how you have categorized that
// payee before. Writes only when you press Approve, and the last run can
// be undone.

import { fmt } from "../money.js";
import * as cz from "../tools/categorize.js";
import {
  button, card, categoryPicker, checkbox, clear, confirmDialog, dateLabel, el,
  emptyRow, hint, logPane, pageHeading, pill, sectionTitle, table,
} from "../ui.js";
import { stat } from "./report_kit.js";

/** Counts for Home's dashboard: what is waiting, and how many have a suggestion. */
export function reviewCounts(state, transactions) {
  const queue = buildQueue(state, transactions);
  return {
    unapproved: queue.filter((i) => i.needsApproval).length,
    uncategorized: queue.filter((i) => i.needsCategory).length,
    suggested: queue.filter((i) => i.needsCategory && i.suggestion?.usable).length,
  };
}

// Unlike state.categoryName(), includes YNAB's internal group, since the
// usual unlisted suggestion is Ready to Assign itself.
function anyCategoryName(state, id) {
  for (const group of state.categoryGroups || []) {
    const found = (group.categories || []).find((c) => c.id === id);
    if (found) return found.name;
  }
  return "a category not in this list";
}

export function buildQueue(state, transactions) {
  const uncategorized = cz.uncategorizedIds(state.categoryGroups);
  const history = cz.payeeHistory(transactions, { uncategorized });
  return cz.reviewQueue(transactions, {
    history,
    uncategorized,
    offBudget: cz.offBudgetAccountIds(state.accounts),
    // Exactly what the category picker lists, so a suggestion is only
    // filled in when it can be shown.
    pickable: new Set(state.flatCategories().map(({ category }) => category.id)),
  });
}

export function categorizePage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("categorize");

  const root = el("div", { class: "page-body" });
  const log = logPane("Reading transactions waiting on you.");
  let queue = [];
  let rows = [];

  root.append(pageHeading(
    "Categorize",
    "Transactions waiting on you in YNAB: no category yet, or not approved. " +
    "A category is suggested from how you have categorized the same payee " +
    "before. Nothing changes in YNAB until you press Approve, and the last " +
    "batch can be undone."));

  const approveButton = button("Approve selected", { accent: true, onClick: apply });
  const undoLink = button("Undo last batch", { small: true, onClick: undo });
  undoLink.classList.add("btn-link");
  const selectionNote = hint("");
  const includeUncategorized = checkbox(
    "Also approve ones with no category", Boolean(settings.approveUncategorized), (value) => {
      settings.approveUncategorized = value;
      store.save();
      paintSelection();
    });

  root.append(card(
    el("div", { class: "card-row" }, approveButton, selectionNote,
      el("span", { class: "spacer" }), undoLink),
    el("div", { class: "card-row" }, includeUncategorized),
    hint("Ticked by default: anything that already has a category, and ones " +
      "where you have used the suggested category for that payee nearly every " +
      "time. Check the rest and pick a category before ticking them.")));

  const stats = el("div", { class: "stat-grid" });
  const list = table([
    { key: "pick", label: "", className: "check" },
    { key: "date", label: "Date" },
    { key: "payee", label: "Payee" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "category", label: "Category" },
  ]);
  root.append(stats, sectionTitle("Waiting on you"), list, log);

  function backups() {
    return (settings.undo || {})[state.budgetId] || [];
  }

  function paintUndo() {
    const count = backups().length;
    undoLink.hidden = !count;
    undoLink.textContent = `Undo last batch (${count})`;
  }

  async function load() {
    if (!state.token || !state.budgetId) {
      return log.write("Connect and choose a budget on the Setup page first.", "error");
    }
    if (!state.hasBudgetData) {
      return log.write("Categories are not loaded. Open Setup and press Reload data.", "error");
    }
    const result = await app.run(() => state.loadAllTransactions(), { log });
    if (!result) return;
    queue = buildQueue(state, result.list);
    log.clearLog();
    log.write(`${queue.length} transaction(s) waiting.`, queue.length ? "ok" : "muted");
    render();
  }

  function render() {
    clear(stats).append(
      stat("Waiting", String(queue.length)),
      stat("No category", String(queue.filter((i) => i.needsCategory).length), {
        kind: queue.some((i) => i.needsCategory) ? "warn" : "ok",
      }),
      stat("To approve", String(queue.filter((i) => i.needsApproval).length)),
      stat("Suggested", String(queue.filter((i) => i.needsCategory && i.suggestion?.usable).length), {
        note: "From your own history",
      }));

    clear(list.tbody);
    rows = [];
    if (!queue.length) {
      emptyRow(list, "Nothing waiting - everything is categorized and approved.");
      paintSelection();
      paintUndo();
      return;
    }

    const selectAll = el("input", { type: "checkbox", "aria-label": "Select all" });
    const headCell = list.querySelectorAll("th")[0];
    clear(headCell).append(selectAll);
    selectAll.addEventListener("change", () => {
      for (const row of rows) row.box.checked = selectAll.checked;
      paintSelection();
    });

    for (const item of queue) {
      const t = item.transaction;
      const box = el("input", { type: "checkbox", "aria-label": `Select ${t.payee_name || "transaction"}` });
      box.checked = Boolean(
        (item.kind !== "normal") ||
        (!item.needsCategory && item.categoryId) ||
        (item.suggestion?.usable && item.suggestion.strength === "strong"));
      box.addEventListener("change", paintSelection);

      let categoryCell;
      if (item.kind === "normal") {
        const picker = categoryPicker(state, {
          onChange: (chosen) => {
            item.categoryId = chosen?.id || null;
            if (item.categoryId) box.checked = true;
            paintSelection();
          },
        });
        if (item.categoryId) picker.setCategory(item.categoryId);
        const suggestion = item.needsCategory ? item.suggestion : null;
        const note = !item.needsCategory ? ""
          : !suggestion ? "No history for this payee - pick one"
            : !suggestion.usable
              ? `Last used ${anyCategoryName(state, suggestion.categoryId)} - pick one`
              : `Suggested: used ${suggestion.count} of ${suggestion.total} times for this payee`;
        const warn = suggestion && (!suggestion.usable || suggestion.strength === "weak");
        categoryCell = el("td", { class: "categorize-cell" }, picker,
          note ? el("div", { class: `hint ${warn ? "is-warn" : ""}`, text: note }) : null);
      } else {
        categoryCell = el("td", { class: "hint", text: item.kind === "transfer"
          ? "Transfer - approve only" : "Split - categories are on its parts" });
      }

      const tags = [];
      if (item.needsApproval) tags.push(pill("Unapproved", "caution"));
      if (item.needsCategory) tags.push(pill("No category", "warn"));

      list.tbody.append(el("tr", {},
        el("td", { class: "check" }, box),
        el("td", { text: dateLabel(t.date) }),
        el("td", {},
          el("div", { class: "history-payee" }, el("span", { text: t.payee_name || "(no payee)" }), ...tags),
          el("div", { class: "hint", text: [t.account_name, t.memo].filter(Boolean).join(" · ") })),
        el("td", {
          class: `num ${t.amount > 0 ? "is-ok" : ""}`,
          text: t.amount > 0 ? `+${fmt(t.amount)}` : fmt(t.amount),
        }),
        categoryCell));
      rows.push({ item, box });
    }
    paintSelection();
    paintUndo();
  }

  function chosen() {
    return rows.filter((row) => row.box.checked).map((row) => row.item);
  }

  function paintSelection() {
    const { updates } = cz.buildUpdate(chosen(), {
      approveUncategorized: includeUncategorized.querySelector("input").checked,
    });
    approveButton.disabled = !updates.length;
    approveButton.textContent = updates.length ? `Approve selected (${updates.length})` : "Approve selected";
    const skipped = chosen().length - updates.length;
    selectionNote.textContent = skipped > 0
      ? `${skipped} ticked with no category will be left as they are.` : "";
  }

  async function apply() {
    const { updates, backup } = cz.buildUpdate(chosen(), {
      approveUncategorized: includeUncategorized.querySelector("input").checked,
    });
    if (!updates.length) return;
    const recategorized = updates.filter((u) => u.category_id).length;
    const confirmed = await confirmDialog("Update YNAB",
      `Update ${updates.length} transaction(s) in '${state.budgetName}'?\n\n` +
      `${recategorized} get a category, ` +
      `${updates.filter((u) => u.approved).length} get approved. ` +
      "You can undo this batch afterwards.", { confirmText: "Update" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Updating ${updates.length} transaction(s)...`, "head");
    const result = await app.run(
      () => state.requireClient().updateTransactions(state.budgetId, updates),
      { log, buttons: [approveButton] });
    if (!result) return;

    saveUndo(backup);
    state.patchTransactions(updates.map(({ id, ...patch }) => ({ id, patch })));
    state.monthCache.clear();
    state.persistSession();
    state.recordRun("categorize");
    await load();
    log.write(`Updated ${updates.length} transaction(s). Undo is above if anything looks wrong.`, "ok");
  }

  function saveUndo(backup) {
    const all = { ...(settings.undo || {}) };
    if (backup.length) all[state.budgetId] = backup;
    else delete all[state.budgetId];
    settings.undo = all;
    store.save();
  }

  async function undo() {
    const backup = backups();
    if (!backup.length) return;
    const confirmed = await confirmDialog("Undo last batch",
      `Put ${backup.length} transaction(s) back how they were - category and ` +
      "approval - before the last Approve?", { confirmText: "Undo" });
    if (!confirmed) return;
    const updates = cz.undoUpdate(backup);
    const result = await app.run(
      () => state.requireClient().updateTransactions(state.budgetId, updates),
      { log, buttons: [approveButton, undoLink] });
    if (!result) return;
    saveUndo([]);
    state.patchTransactions(updates.map(({ id, ...patch }) => ({ id, patch })));
    state.monthCache.clear();
    state.persistSession();
    log.write(`Undone. ${updates.length} transaction(s) put back.`, "ok");
    load();
  }

  paintUndo();
  load();
  return root;
}
