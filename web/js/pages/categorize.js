// Categorize: transactions waiting on you in YNAB - no category yet, or not
// approved - with a category suggested from how you have categorized that
// payee before, or that kind of shop. Notes and splits can be added here
// too. Writes only when you press Approve, and the last run (splits aside)
// can be undone.

import { fmt, fromMilliunits, toMilliunits } from "../money.js";
import * as cz from "../tools/categorize.js";
import { isComplete, ruleRatio } from "../tools/shared_expenses.js";
import { ownerOf, sharedRatio } from "../tools/split_sheet.js";
import {
  button, categoryPicker, checkbox, clear, confirmDialog, customDialog, dateLabel, el,
  hint, logPane, pageHeading,
} from "../ui.js";

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

// "Groceries · Sam - Spending": a split's parts often share a name.
function categoryWithGroup(state, id) {
  for (const group of state.categoryGroups || []) {
    const found = (group.categories || []).find((c) => c.id === id);
    if (found) return group.name === "Internal Master Category" ? found.name : `${found.name} · ${group.name}`;
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
    "undone, except splits, which can be changed in YNAB. Ticked to start: " +
    "anything that already has a category, and suggestions you use nearly " +
    "every time."));

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

  // One compact bar, and the list as rows that read at a glance (at
  // explicit user request: "it doesn't look great visually to read"): no
  // stat boxes, no status pills, a note box only when wanted.
  root.append(el("div", { class: "card review-bar" },
    el("div", { class: "card-row" }, approveButton, selectionNote,
      el("span", { class: "spacer" }), undoLink),
    includeUncategorized));

  const selectAll = el("input", { type: "checkbox", "aria-label": "Select all" });
  selectAll.addEventListener("change", () => {
    for (const row of rows) {
      row.item.checked = selectAll.checked;
      row.box.checked = selectAll.checked;
    }
    paintSelection();
  });
  const summary = el("span", { class: "review-summary" });
  const list = el("div", { class: "review-list" });
  root.append(
    el("div", { class: "review-head" }, el("label", { class: "review-check" }, selectAll), summary),
    list, log);

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
    const counts = [
      `${queue.length} waiting`,
      queue.some((i) => i.needsCategory) ? `${queue.filter((i) => i.needsCategory).length} need a category` : "",
      queue.some((i) => i.needsCategory && i.suggestion?.usable)
        ? `${queue.filter((i) => i.needsCategory && i.suggestion?.usable).length} suggested` : "",
    ].filter(Boolean);
    summary.textContent = counts.join(" \u00b7 ");

    clear(list);
    rows = [];
    selectAll.hidden = !queue.length;
    if (!queue.length) {
      list.append(el("p", { class: "review-empty", text: "Nothing waiting. Everything is categorized and approved." }));
      paintSelection();
      paintUndo();
      return;
    }
    for (const item of queue) list.append(reviewRow(item));
    paintSelection();
    paintUndo();
  }

  function reviewRow(item) {
    const t = item.transaction;
    const row = el("div", { class: "review-row" });
    const box = el("input", { type: "checkbox", "aria-label": `Select ${t.payee_name || "transaction"}` });
    // Ticks live on the item, so redrawing the list (after a split is set
    // up) keeps them.
    if (item.checked === undefined) {
      item.checked = Boolean(
        (item.kind !== "normal") ||
        (!item.needsCategory && item.categoryId) ||
        (item.suggestion?.usable && item.suggestion.strength === "strong"));
    }
    const paintTick = () => row.classList.toggle("is-checked", item.checked);
    const tick = (on) => {
      item.checked = on;
      box.checked = on;
      paintTick();
    };
    box.checked = item.checked;
    paintTick();
    box.addEventListener("change", () => {
      item.checked = box.checked;
      paintTick();
      paintSelection();
    });

    // ---- what it is ----
    const meta = [shortDate(t.date), t.account_name || ""];
    if (item.needsApproval && !item.needsCategory) meta.push("not approved yet");
    const note = noteField(item, tick);
    const main = el("div", { class: "review-main" },
      el("div", { class: "review-payee", text: t.payee_name || "(no payee)" }),
      el("div", { class: "review-meta", text: meta.filter(Boolean).join(" \u00b7 ") }),
      note.field);

    // ---- its category ----
    const cat = el("div", { class: "review-cat" });
    if (item.kind === "normal" && item.split) {
      cat.append(
        el("div", { class: "review-split" },
          ...item.split.map((leg) => el("div", { class: "review-split-leg" },
            el("span", { text: categoryWithGroup(state, leg.categoryId) }),
            el("span", { class: "num", text: fmt(Math.abs(leg.amount)) })))),
        actions(
          linkButton("Change split", () => editSplit(item)),
          linkButton("Don't split", () => {
            item.split = null;
            render();
          }),
          note.link));
    } else if (item.kind === "normal") {
      const picker = categoryPicker(state, {
        onChange: (picked) => {
          item.categoryId = picked?.id || null;
          if (item.categoryId) tick(true);
          paintSelection();
        },
      });
      if (item.categoryId) picker.setCategory(item.categoryId);
      const why = suggestionNote(item);
      cat.append(picker,
        why ? el("div", { class: "review-why", text: why.text }) : "",
        actions(
          item.lastSplit ? linkButton("Split like last time", () => editSplit(item, "last")) : null,
          state.peopleNamed ? linkButton(`Shared split ${sharedSetup(item.categoryId).short}`, () => editSplit(item, "shared")) : null,
          linkButton("Split", () => editSplit(item)),
          note.link));
    } else {
      cat.append(el("div", { class: "review-why", text: item.kind === "transfer"
        ? "Transfer: approve only" : "Already split: approve only" }), actions(note.link));
    }

    row.append(
      el("label", { class: "review-check" }, box),
      main,
      cat,
      el("div", {
        class: `review-amount ${t.amount > 0 ? "is-in" : ""}`,
        text: t.amount > 0 ? `+${fmt(t.amount)}` : fmt(t.amount),
      }));
    rows.push({ item, box });
    return row;
  }

  // A note can be added or changed on anything in the list (at explicit
  // user request); typing one ticks the row. The box only shows once there
  // is a note or "Add note" (with the row's other links) is pressed, so a
  // list of empty boxes does not crowd every row.
  function noteField(item, tick) {
    const t = item.transaction;
    const value = item.memo ?? t.memo ?? "";
    const input = el("input", {
      type: "text", class: "review-note-input", placeholder: "Note", enterkeyhint: "done",
      "aria-label": `Note for ${t.payee_name || "transaction"}`,
    });
    input.value = value;
    input.addEventListener("input", () => {
      item.memo = input.value;
      tick(true);
      paintSelection();
    });
    const field = el("div", { class: "review-note" });
    if (value) {
      field.append(input);
      return { field, link: null };
    }
    field.hidden = true;
    const link = linkButton("Add note", () => {
      field.append(input);
      field.hidden = false;
      link.remove();
      input.focus();
    });
    return { field, link };
  }

  function actions(...links) {
    return el("div", { class: "review-actions" }, ...links.filter(Boolean));
  }

  /** "Nov 10" this year, "Nov 10, 2025" otherwise. */
  function shortDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-CA", y === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" });
  }

  function linkButton(text, onClick) {
    const node = button(text, { small: true, onClick });
    node.classList.add("btn-link");
    return node;
  }

  // One short line on why the category is what it is.
  function suggestionNote(item) {
    if (!item.needsCategory) return null;
    const suggestion = item.suggestion;
    const kindLabel = (found) => `${cz.KIND_LABELS[found.kind] || found.kind}${found.shop ? ` (${found.shop})` : ""}`;
    if (!suggestion) {
      if (item.lastSplit) {
        const parts = item.lastSplit.legs.map((leg) =>
          `${anyCategoryName(state, leg.categoryId)} ${Math.round(leg.share * 100)}%`);
        return { text: `Split last time: ${parts.join(", ")}` };
      }
      if (item.looksLike) return { text: `Looks like ${kindLabel(item.looksLike)}. Pick one and it is suggested next time.` };
      return { text: "New payee. Pick a category." };
    }
    if (!suggestion.usable) {
      return { text: `Last time: ${anyCategoryName(state, suggestion.categoryId)}, which can't be picked here.` };
    }
    if (suggestion.source === "kind") {
      return { text: `Your usual for ${kindLabel(suggestion)} \u00b7 ${suggestion.count} of ${suggestion.total}` };
    }
    return { text: `Your usual for this payee \u00b7 ${suggestion.count} of ${suggestion.total}` };
  }

  // ---------- splitting ----------

  // Shared Expenses' mappings (a shared category and each person's own),
  // offered as one-tap splits at the shared ratio.
  function sharedRules() {
    const shared = store.section("sharedExpenses");
    return (shared.rules || []).filter(isComplete);
  }

  // The Shared Expenses mapping a category belongs to, if any.
  function ruleFor(categoryId) {
    return categoryId ? sharedRules().find((r) => [r.sharedId, r.person1Id, r.person2Id].includes(categoryId)) || null : null;
  }

  // The split share set once in Settings, or a category's own split from
  // its Shared Expenses mapping, and both people's names for it.
  function sharedSetup(categoryId = null) {
    const people = state.withPeople({});
    const ratio = ruleRatio(ruleFor(categoryId), sharedRatio(people));
    const percent = Math.round(ratio * 100);
    return {
      ratio,
      label: `${state.personName(1)} ${percent}%, ${state.personName(2)} ${100 - percent}%`,
      short: `${percent}/${100 - percent}`,
    };
  }

  // The shared split from Settings: each person's share at the Settings
  // ratio, in their own version of the category (a Shared Expenses mapping
  // for it first, else the same name in a group that person owns).
  function sharedLegs(total, categoryId) {
    const { ratio } = sharedSetup(categoryId);
    const people = state.withPeople({});
    const rule = ruleFor(categoryId);
    const ids = rule ? { p1: rule.person1Id, p2: rule.person2Id }
      : cz.personCategories(categoryId, state.flatCategories(true).map(({ group, category }) => ({
        id: category.id, name: category.name, owner: ownerOf(group, "", people),
      })), { names: [state.person(1).name, state.person(2).name] });
    const [a, b] = cz.splitByShares(total, [ratio, 1 - ratio]);
    return [
      { categoryId: ids.p1, amount: a, memo: "", label: state.personName(1) },
      { categoryId: ids.p2, amount: b, memo: "", label: state.personName(2) },
    ];
  }

  async function editSplit(item, start) {
    const t = item.transaction;
    const total = t.amount;
    const sign = total < 0 ? -1 : 1;
    const ratio = sharedSetup().ratio;
    const fromShares = (legs) => {
      const amounts = cz.splitByShares(total, legs.map((leg) => leg.share));
      return legs.map((leg, i) => ({ categoryId: leg.categoryId, amount: amounts[i], memo: leg.memo || "" }));
    };
    let legs = item.split ? item.split.map((leg) => ({ ...leg }))
      : start === "last" && item.lastSplit ? fromShares(item.lastSplit.legs)
        : start === "shared" ? sharedLegs(total, item.categoryId)
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
      if (state.peopleNamed) {
        shortcuts.append(button(`Shared (${sharedSetup(legs.find((leg) => leg.categoryId)?.categoryId || item.categoryId).label})`, {
          small: true,
          onClick: () => use(sharedLegs(total, legs.find((leg) => leg.categoryId)?.categoryId || item.categoryId)),
        }));
      }
      const rules = sharedRules();
      if (rules.length) {
        const sharedPick = el("select", { "aria-label": "Shared split by mapping" },
          el("option", { value: "", text: "Shared mapping..." }),
          ...rules.map((rule, i) => {
            const own = Math.round(ruleRatio(rule, ratio) * 100);
            return el("option", { value: String(i), text: `${rule.name || anyCategoryName(state, rule.sharedId)} (${own}/${100 - own})` });
          }));
        sharedPick.addEventListener("change", () => {
          const rule = rules[Number(sharedPick.value)];
          sharedPick.value = "";
          if (!rule) return;
          const share = ruleRatio(rule, ratio);
          const [a, b] = cz.splitByShares(total, [share, 1 - share]);
          use([
            { categoryId: rule.person1Id, amount: a, memo: "", label: state.personName(1) },
            { categoryId: rule.person2Id, amount: b, memo: "", label: state.personName(2) },
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
          if (leg.label) rowsHost.append(el("div", { class: "split-label", text: leg.label }));
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
        value: () => legs.map(({ label, ...leg }) => leg),
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
