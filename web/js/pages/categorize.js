// Categorize: transactions waiting on you in YNAB - no category yet, or not
// approved - with a category suggested from how you have categorized that
// payee before, or that kind of shop. Notes and splits can be added here
// too. Writes only when you press Approve, and the last run (splits aside)
// can be undone.

import { fmt, fromMilliunits, toMilliunits } from "../money.js";
import * as cz from "../tools/categorize.js";
import { isComplete } from "../tools/shared_expenses.js";
import {
  button, card, categoryPicker, checkbox, clear, confirmDialog, customDialog, dateLabel, el,
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
    kinds: cz.kindHistory(transactions, { uncategorized }),
    splits: cz.splitHistory(transactions),
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
    "before, or for a new one, what you use for that kind of shop (a new " +
    "restaurant gets your usual restaurant category). You can add a note or " +
    "split one into several categories, including your shared split. Nothing " +
    "changes in YNAB until you press Approve, and the last batch can be " +
    "undone, except splits, which can be changed in YNAB."));

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
      "where the suggestion is what you use nearly every time. Check the rest " +
      "and pick a category before ticking them.")));

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
      return log.write("Connect and choose a budget on the Settings page first.", "error");
    }
    if (!state.hasBudgetData) {
      return log.write("Categories are not loaded. Open Settings and press Reload data.", "error");
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
      // Ticks live on the item, so redrawing the list (after a split is set
      // up) keeps them.
      if (item.checked === undefined) {
        item.checked = Boolean(
          (item.kind !== "normal") ||
          (!item.needsCategory && item.categoryId) ||
          (item.suggestion?.usable && item.suggestion.strength === "strong"));
      }
      box.checked = item.checked;
      const tick = (on) => {
        item.checked = on;
        box.checked = on;
      };
      box.addEventListener("change", () => {
        item.checked = box.checked;
        paintSelection();
      });

      let categoryCell;
      if (item.kind === "normal" && item.split) {
        categoryCell = el("td", { class: "categorize-cell" },
          el("div", { class: "categorize-split" },
            el("strong", { text: "Split" }),
            ...item.split.map((leg) => el("div", { class: "categorize-split-leg" },
              el("span", { text: anyCategoryName(state, leg.categoryId) }),
              el("span", { class: "num", text: fmt(Math.abs(leg.amount)) })))),
          el("div", { class: "categorize-actions" },
            linkButton("Change split", () => editSplit(item)),
            linkButton("Don't split", () => {
              item.split = null;
              render();
            })));
      } else if (item.kind === "normal") {
        const picker = categoryPicker(state, {
          onChange: (chosen) => {
            item.categoryId = chosen?.id || null;
            if (item.categoryId) tick(true);
            paintSelection();
          },
        });
        if (item.categoryId) picker.setCategory(item.categoryId);
        const note = suggestionNote(item);
        categoryCell = el("td", { class: "categorize-cell" }, picker,
          note ? el("div", { class: `hint ${note.warn ? "is-warn" : ""}`, text: note.text }) : null,
          el("div", { class: "categorize-actions" },
            item.lastSplit ? linkButton("Split like last time", () => editSplit(item, "last")) : null,
            linkButton("Split", () => editSplit(item))));
      } else {
        categoryCell = el("td", { class: "hint", text: item.kind === "transfer"
          ? "Transfer - approve only" : "Split - categories are on its parts" });
      }

      const tags = [];
      if (item.needsApproval) tags.push(pill("Unapproved", "caution"));
      if (item.needsCategory) tags.push(pill("No category", "warn"));

      // A note can be added or changed on anything in the list (at explicit
      // user request); typing one ticks the row.
      const memo = el("input", {
        type: "text",
        class: "categorize-memo",
        placeholder: "Add a note",
        enterkeyhint: "done",
        "aria-label": `Note for ${t.payee_name || "transaction"}`,
      });
      memo.value = item.memo ?? t.memo ?? "";
      memo.addEventListener("input", () => {
        item.memo = memo.value;
        tick(true);
        paintSelection();
      });

      list.tbody.append(el("tr", {},
        el("td", { class: "check" }, box),
        el("td", { text: dateLabel(t.date) }),
        el("td", {},
          el("div", { class: "history-payee" }, el("span", { text: t.payee_name || "(no payee)" }), ...tags),
          el("div", { class: "hint", text: t.account_name || "" }),
          memo),
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

  function linkButton(text, onClick) {
    const node = button(text, { small: true, onClick });
    node.classList.add("btn-link");
    return node;
  }

  function suggestionNote(item) {
    if (!item.needsCategory) return null;
    const suggestion = item.suggestion;
    const kindLabel = (found) => `${cz.KIND_LABELS[found.kind] || found.kind}${found.shop ? ` (${found.shop})` : ""}`;
    if (!suggestion) {
      if (item.lastSplit) {
        const parts = item.lastSplit.legs.map((leg) =>
          `${anyCategoryName(state, leg.categoryId)} ${Math.round(leg.share * 100)}%`);
        return { text: `Split last time: ${parts.join(", ")}`, warn: false };
      }
      if (item.looksLike) {
        return { text: `Looks like ${kindLabel(item.looksLike)}. Pick one and it is suggested next time.`, warn: true };
      }
      return { text: "No history for this payee - pick one", warn: true };
    }
    if (!suggestion.usable) {
      return { text: `Last used ${anyCategoryName(state, suggestion.categoryId)} - pick one`, warn: true };
    }
    const warn = suggestion.strength === "weak";
    if (suggestion.source === "kind") {
      return {
        text: `Suggested: your usual for ${kindLabel(suggestion)}, ${suggestion.count} of ${suggestion.total} times`,
        warn,
      };
    }
    return { text: `Suggested: used ${suggestion.count} of ${suggestion.total} times for this payee`, warn };
  }

  // ---------- splitting ----------

  // Shared Expenses' mappings (a shared category and each person's own),
  // offered as one-tap splits at the shared ratio.
  function sharedRules() {
    const shared = store.section("sharedExpenses");
    return (shared.rules || []).filter(isComplete);
  }

  async function editSplit(item, start) {
    const t = item.transaction;
    const total = t.amount;
    const sign = total < 0 ? -1 : 1;
    const ratio = Number(store.section("sharedExpenses").person1Ratio) || 0.5;
    const fromShares = (legs) => {
      const amounts = cz.splitByShares(total, legs.map((leg) => leg.share));
      return legs.map((leg, i) => ({ categoryId: leg.categoryId, amount: amounts[i], memo: leg.memo || "" }));
    };
    let legs = item.split ? item.split.map((leg) => ({ ...leg }))
      : start === "last" && item.lastSplit ? fromShares(item.lastSplit.legs)
        : [
          { categoryId: item.categoryId, amount: total, memo: "" },
          { categoryId: null, amount: 0, memo: "" },
        ];

    const result = await customDialog(`Split ${t.payee_name || "transaction"}`, (body) => {
      const rowsHost = el("div", { class: "split-rows" });
      const left = el("p", { class: "split-left" });
      const problem = el("p", { class: "split-problem" });

      const shortcuts = el("div", { class: "split-shortcuts" });
      if (item.lastSplit) {
        shortcuts.append(button("Like last time", { small: true, onClick: () => use(fromShares(item.lastSplit.legs)) }));
      }
      shortcuts.append(button("Half and half", {
        small: true,
        onClick: () => {
          const [a, b] = cz.splitByShares(total, [1, 1]);
          use([
            { categoryId: legs[0]?.categoryId || null, amount: a, memo: legs[0]?.memo || "" },
            { categoryId: legs[1]?.categoryId || null, amount: b, memo: legs[1]?.memo || "" },
          ]);
        },
      }));
      const rules = sharedRules();
      if (rules.length) {
        const percent = Math.round(ratio * 100);
        const sharedPick = el("select", { "aria-label": "Shared split" },
          el("option", { value: "", text: `Shared split (${percent}/${100 - percent})...` }),
          ...rules.map((rule, i) => el("option", { value: String(i), text: rule.name || anyCategoryName(state, rule.sharedId) })));
        sharedPick.addEventListener("change", () => {
          const rule = rules[Number(sharedPick.value)];
          sharedPick.value = "";
          if (!rule) return;
          const [a, b] = cz.splitByShares(total, [ratio, 1 - ratio]);
          use([
            { categoryId: rule.person1Id, amount: a, memo: "" },
            { categoryId: rule.person2Id, amount: b, memo: "" },
          ]);
        });
        shortcuts.append(sharedPick);
      }

      function use(next) {
        legs = next;
        draw();
      }

      function paintLeft() {
        const remaining = total - legs.reduce((a, leg) => a + leg.amount, 0);
        left.textContent = remaining
          ? `${fmt(Math.abs(remaining))} ${remaining * sign > 0 ? "still to split" : "too much"}`
          : `All ${fmt(Math.abs(total))} split.`;
        left.classList.toggle("is-warn", Boolean(remaining));
      }

      function draw() {
        clear(rowsHost);
        const amountInputs = [];
        legs.forEach((leg, index) => {
          const picker = categoryPicker(state, { onChange: (chosen) => { leg.categoryId = chosen?.id || null; } });
          if (leg.categoryId) picker.setCategory(leg.categoryId);
          const amount = el("input", {
            type: "number", inputmode: "decimal", step: "0.01", min: "0", class: "split-amount",
            "aria-label": "Amount", enterkeyhint: "done",
          });
          amount.value = leg.amount ? fromMilliunits(Math.abs(leg.amount)).toFixed(2) : "";
          amountInputs.push(amount);
          amount.addEventListener("input", () => {
            leg.amount = sign * toMilliunits(amount.value);
            // With two parts, the other one takes whatever is left.
            if (legs.length === 2) {
              const other = legs[1 - index];
              other.amount = total - leg.amount;
              amountInputs[1 - index].value = other.amount ? fromMilliunits(Math.abs(other.amount)).toFixed(2) : "0.00";
            }
            paintLeft();
          });
          const note = el("input", {
            type: "text", class: "split-memo", placeholder: "Note", "aria-label": "Note", enterkeyhint: "done",
          });
          note.value = leg.memo || "";
          note.addEventListener("input", () => { leg.memo = note.value; });
          const remove = button("\u00d7", {
            small: true,
            onClick: () => {
              legs.splice(index, 1);
              draw();
            },
          });
          remove.setAttribute("aria-label", "Remove this part");
          remove.disabled = legs.length <= 2;
          rowsHost.append(el("div", { class: "split-row" }, picker, amount, note, remove));
        });
        paintLeft();
      }

      const add = button("Add a part", {
        small: true,
        onClick: () => {
          const remaining = total - legs.reduce((a, leg) => a + leg.amount, 0);
          legs.push({ categoryId: null, amount: remaining, memo: "" });
          draw();
        },
      });

      body.append(
        el("p", { class: "hint", text: `${dateLabel(t.date)} · ${t.account_name || ""} · total ${fmt(Math.abs(total))}` }),
        shortcuts, rowsHost, el("div", { class: "card-row" }, add, el("span", { class: "spacer" }), left), problem);
      draw();
      return {
        validate: () => {
          problem.textContent = cz.splitProblem(total, legs);
          return !problem.textContent;
        },
        value: () => legs.map((leg) => ({ ...leg })),
      };
    }, { confirmText: "Use this split", wide: true });

    if (!result) return;
    item.split = result;
    item.checked = true;
    render();
  }

  function chosen() {
    return rows.filter((row) => row.box.checked).map((row) => row.item);
  }

  function currentUpdate() {
    return cz.buildUpdate(chosen(), {
      approveUncategorized: includeUncategorized.querySelector("input").checked,
    });
  }

  function paintSelection() {
    const { updates, splits } = currentUpdate();
    const count = updates.length + splits.length;
    approveButton.disabled = !count;
    approveButton.textContent = count ? `Approve selected (${count})` : "Approve selected";
    const skipped = chosen().length - count;
    selectionNote.textContent = skipped > 0
      ? `${skipped} ticked with no category will be left as they are.` : "";
  }

  async function apply() {
    const { updates, backup, splits } = currentUpdate();
    if (!updates.length && !splits.length) return;
    const recategorized = updates.filter((u) => u.category_id).length;
    const noted = updates.filter((u) => u.memo !== undefined).length;
    const lines = [
      `${recategorized} get a category`,
      `${updates.filter((u) => u.approved).length + splits.length} get approved`,
      noted ? `${noted} get a note` : "",
      splits.length ? `${splits.length} get split` : "",
    ].filter(Boolean);
    const confirmed = await confirmDialog("Update YNAB",
      `Update ${updates.length + splits.length} transaction(s) in '${state.budgetName}'?\n\n` +
      `${lines.join(", ")}. ` +
      (updates.length ? "You can undo this batch afterwards" : "") +
      (splits.length ? `${updates.length ? ", except" : "Undo here does not cover"} splits: change those in YNAB if needed.` : "."),
      { confirmText: "Update" });
    if (!confirmed) return;

    log.clearLog();
    if (updates.length) {
      log.write(`Updating ${updates.length} transaction(s)...`, "head");
      const result = await app.run(
        () => state.requireClient().updateTransactions(state.budgetId, updates),
        { log, buttons: [approveButton] });
      if (!result) return;
      saveUndo(backup);
      state.patchTransactions(updates.map(({ id, ...patch }) => ({ id, patch })));
    }

    let splitDone = 0;
    if (splits.length) {
      log.write(`Splitting ${splits.length} transaction(s)...`, "head");
      await app.run(async () => {
        for (const body of splits) {
          try {
            await state.requireClient().updateTransaction(state.budgetId, body.id, body);
            splitDone += 1;
            state.patchTransactions([{
              id: body.id,
              patch: {
                category_id: null,
                approved: true,
                memo: body.memo,
                subtransactions: body.subtransactions.map((leg) => ({ ...leg, deleted: false })),
              },
            }]);
          } catch (error) {
            log.write(`Could not split one transaction: ${error.message}`, "error");
          }
        }
      }, { log, buttons: [approveButton] });
    }

    state.monthCache.clear();
    state.persistSession();
    state.recordRun("categorize");
    await load();
    log.write(`Updated ${updates.length + splitDone} transaction(s).` +
      (updates.length ? " Undo is above if anything looks wrong." : ""), "ok");
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
      `Put ${backup.length} transaction(s) back how they were - category, ` +
      "approval and note - before the last Approve?", { confirmText: "Undo" });
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
