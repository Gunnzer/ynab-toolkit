// Shared Expenses: map shared categories, preview, apply, undo.

import { fmt } from "../money.js";
import * as shared from "../tools/shared_expenses.js";
import {
  button, card, categoryPicker, checkbox, clear, confirmDialog, customDialog,
  el, emptyRow, field, hint, logPane, pageHeading, sectionTitle, table,
  textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing run yet. Preview is always safe: it shows every transaction that " +
  "would change without touching your budget.";

export function sharedExpensesPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("sharedExpenses");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let planned = [];
  let editingIndex = null;
  let rules = (settings.rules || []).map((rule) => ({ ...rule }));

  root.append(pageHeading(
    "Shared Expenses",
    "Finds transactions sitting in your shared categories and converts each " +
    "one into a native YNAB split between two people. Every change is backed " +
    "up first so it can be undone."));

  // ---------- settings ----------

  // The two people, and their share of shared expenses, are defined once,
  // in Setup (share lives right under each person's account tag there).
  // Shown here read only so the split is legible without leaving the page.
  const p1Name = textInput(state.personName(1), {});
  const p2Name = textInput(state.personName(2), {});
  p1Name.disabled = true;
  p2Name.disabled = true;
  const skipSplit = checkbox("Skip transactions that are already split",
    settings.skipAlreadySplit !== false, save);

  const ratioLabel = hint("");

  function ratio() {
    const value = Number(settings.person1Ratio);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(
        "Set each person's share of shared expenses on the Setup page first.");
    }
    return value;
  }

  function paintRatio() {
    const percent = Number(settings.person1Ratio) * 100;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      ratioLabel.textContent = "Set the split on the Setup page.";
      ratioLabel.className = "hint is-error";
      return;
    }
    ratioLabel.textContent =
      `Person 1: ${p1Name.value || "Person 1"} ${percent}%   /   ` +
      `Person 2: ${p2Name.value || "Person 2"} ${100 - percent}%`;
    ratioLabel.className = "hint";
  }

  function save() {
    settings.skipAlreadySplit = skipSplit.querySelector("input").checked;
    settings.rules = rules;
    store.save();
    paintLabels();
  }

  root.append(card(
    el("div", { class: "card-grid" },
      el("div", { class: "stack" }, field("Person 1", p1Name)),
      el("div", { class: "stack" }, field("Person 2", p2Name)),
      el("div", {}, el("span", { class: "field-label", text: "Split" }), ratioLabel)),
    hint("Names and the split are set on the Setup page."),
    skipSplit));

  // ---------- mapping ----------

  const pickShared = categoryPicker(state, { onChange: () => setBuilderStatus("") });
  const pickP1 = categoryPicker(state, { onChange: () => setBuilderStatus("") });
  const pickP2 = categoryPicker(state, { onChange: () => setBuilderStatus("") });

  const labelP1 = el("span", { class: "field-label" });
  const labelP2 = el("span", { class: "field-label" });
  const builderStatus = hint("");
  const commitButton = button("Add", { accent: true, onClick: commitRule });
  const cancelButton = button("Cancel", { onClick: cancelEdit });
  cancelButton.hidden = true;

  const rulesTable = table([
    { key: "shared", label: "Shared category" },
    { key: "p1", label: "Person 1" },
    { key: "p2", label: "Person 2" },
    { key: "actions", label: "", className: "actions" },
  ]);
  rulesTable.classList.add("rules-table");

  // Configured once and then rarely touched, so it lives behind a
  // disclosure like Bill Splitting's "Tool setup" - the mapping card plus
  // its rules table takes up a lot of room for something you only open to
  // add or fix a rule.
  const mappingSummary = hint("");
  const mappingBody = el("div", { class: "tool-setup-body" });
  const mappingBlock = el("details", { class: "tool-setup" },
    el("summary", {},
      el("span", { class: "caret", "aria-hidden": "true", text: "▾" }),
      el("span", { class: "tool-setup-title", text: "Shared category mapping" }),
      mappingSummary),
    mappingBody);
  mappingBlock.open = Boolean(settings.mappingOpen);
  mappingBlock.addEventListener("toggle", () => {
    settings.mappingOpen = mappingBlock.open;
    store.save();
  });
  root.append(mappingBlock);

  mappingBody.append(
    el("div", { class: "section-head" },
      el("span", { class: "spacer" }),
      button("Clear all", { small: true, onClick: clearRules })),
    card(
      el("div", { class: "card-grid" },
        el("div", {}, el("span", { class: "field-label", text: "Shared category" }), pickShared),
        el("div", {}, labelP1, pickP1),
        el("div", {}, labelP2, pickP2)),
      el("div", { class: "card-row" }, commitButton, cancelButton, builderStatus)),
    rulesTable,
    hint("Pick the three categories and press Add. Use Edit on a row to " +
      "change it."));

  function paintLabels() {
    labelP1.textContent = `${p1Name.value || "Person 1"} gets`;
    labelP2.textContent = `${p2Name.value || "Person 2"} gets`;
  }

  function setBuilderStatus(text, kind = "") {
    builderStatus.textContent = text;
    builderStatus.className = kind ? `hint is-${kind}` : "hint";
  }

  function renderRules() {
    mappingSummary.textContent = rules.length
      ? `${rules.length} mapping${rules.length === 1 ? "" : "s"} configured`
      : "No mappings yet";
    if (!rules.length) {
      emptyRow(rulesTable, "No mappings yet. Add one above.");
      return;
    }
    clear(rulesTable.tbody);
    rules.forEach((rule, index) => {
      rulesTable.tbody.append(el("tr", {},
        el("td", { text: rule.name || state.categoryName(rule.sharedId) }),
        el("td", { text: rule.person1Name || state.categoryName(rule.person1Id) }),
        el("td", { text: rule.person2Name || state.categoryName(rule.person2Id) }),
        el("td", { class: "actions" },
          el("div", { class: "inline" },
            button("Edit", { small: true, onClick: () => editRule(index) }),
            button("Remove", { small: true, danger: true, onClick: () => removeRule(index) })))));
    });
  }

  function editRule(index) {
    const rule = rules[index];
    editingIndex = index;
    pickShared.setCategory(rule.sharedId, rule.name);
    pickP1.setCategory(rule.person1Id, rule.person1Name);
    pickP2.setCategory(rule.person2Id, rule.person2Name);
    commitButton.textContent = "Update";
    cancelButton.hidden = false;
    setBuilderStatus(`Editing '${rule.name}'. Change a category, then Update.`);
  }

  function cancelEdit() {
    editingIndex = null;
    for (const picker of [pickShared, pickP1, pickP2]) picker.clearSelection();
    commitButton.textContent = "Add";
    cancelButton.hidden = true;
    setBuilderStatus("");
  }

  function commitRule() {
    if (!state.hasBudgetData) {
      return setBuilderStatus("Load a budget on the Setup page first.", "error");
    }
    const sharedCategory = pickShared.getCategory();
    const first = pickP1.getCategory();
    const second = pickP2.getCategory();

    const missing = [
      ["Shared category", sharedCategory],
      [p1Name.value || "Person 1", first],
      [p2Name.value || "Person 2", second],
    ].find(([, value]) => !value);
    if (missing) return setBuilderStatus(`${missing[0]}: choose a category.`, "error");

    if (first.id === second.id) {
      return setBuilderStatus("The two people need different categories.", "error");
    }
    if (sharedCategory.id === first.id || sharedCategory.id === second.id) {
      return setBuilderStatus(
        "The shared category cannot also be a personal one.", "error");
    }
    const clash = rules.findIndex(
      (rule, index) => rule.sharedId === sharedCategory.id && index !== editingIndex);
    if (clash >= 0) {
      return setBuilderStatus(
        `'${sharedCategory.name}' is already mapped on row ${clash + 1}.`, "error");
    }

    const rule = {
      sharedId: sharedCategory.id, name: sharedCategory.name,
      person1Id: first.id, person1Name: first.name,
      person2Id: second.id, person2Name: second.name,
    };
    const message = editingIndex === null
      ? `Added '${sharedCategory.name}'.` : `Updated '${sharedCategory.name}'.`;
    if (editingIndex === null) rules.push(rule);
    else rules[editingIndex] = rule;

    save();
    cancelEdit();
    renderRules();
    setBuilderStatus(message, "ok");
  }

  function removeRule(index) {
    const [removed] = rules.splice(index, 1);
    save();
    cancelEdit();
    renderRules();
    setBuilderStatus(`Removed '${removed.name}'.`);
  }

  async function clearRules() {
    if (!rules.length) return;
    if (!await confirmDialog("Clear all mappings",
      `Remove all ${rules.length} mapping(s)?`, { confirmText: "Remove" })) return;
    rules = [];
    save();
    cancelEdit();
    renderRules();
  }

  // ---------- actions ----------

  const previewButton = button("Preview (no changes)", { onClick: preview });
  const applyButton = button("Apply splits", { accent: true, onClick: applySelected });
  const undoButton = button("Undo", { danger: true, onClick: undo });
  const backupLabel = hint("");
  applyButton.disabled = true;

  root.append(el("div", { class: "card-row" },
    previewButton, applyButton, undoButton, backupLabel));

  // ---------- preview results ----------

  const resultsTable = table([
    { key: "check", label: "", className: "check" },
    { key: "date", label: "Date" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "p1", label: "Person 1", className: "num" },
    { key: "p2", label: "Person 2", className: "num" },
  ]);
  const resultsHint = hint(
    "Run Preview to see exactly what would change. Nothing is written until " +
    "you press Apply.");

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Preview"), el("span", { class: "spacer" }),
      button("Select all", { small: true, onClick: () => checkAll(true) }),
      button("Select none", { small: true, onClick: () => checkAll(false) })),
    resultsTable, resultsHint);

  // ---------- last applied ----------
  //
  // Apply used to just clear the preview, so there was nothing left on
  // screen to check what actually happened. This is a read-only record of
  // the most recent run - Undo (above) is still what reverses it.

  const appliedTable = table([
    { key: "date", label: "Date" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount", className: "num" },
    { key: "p1", label: "Person 1", className: "num" },
    { key: "p2", label: "Person 2", className: "num" },
  ]);
  const appliedSection = el("div", {},
    sectionTitle("Last applied"),
    hint(""),
    appliedTable);
  appliedSection.hidden = true;
  root.append(appliedSection);

  root.append(log);

  function showApplied(items) {
    appliedSection.hidden = !items.length;
    if (!items.length) return;

    appliedTable.columns[3].label = p1Name.value || "Person 1";
    appliedTable.columns[4].label = p2Name.value || "Person 2";
    const headers = appliedTable.querySelectorAll("th");
    headers[3].textContent = appliedTable.columns[3].label;
    headers[4].textContent = appliedTable.columns[4].label;

    clear(appliedTable.tbody);
    for (const item of items) {
      appliedTable.tbody.append(el("tr", {},
        el("td", { text: item.transaction.date }),
        el("td", { text: `${item.rule.name}  ${item.transaction.payee_name || ""}`.trim() }),
        el("td", { class: "num", text: fmt(item.transaction.amount) }),
        el("td", { class: "num", text: fmt(item.person1Amount) }),
        el("td", { class: "num", text: fmt(item.person2Amount) })));
    }
    appliedSection.querySelector(".hint").textContent =
      `${items.length} transaction(s) converted just now. Use Undo above ` +
      "if any of this needs reversing.";
  }

  function checkAll(checked) {
    for (const box of resultsTable.tbody.querySelectorAll("input[type=checkbox]")) {
      box.checked = checked;
    }
    updateApplyButton();
  }

  function selectedPlanned() {
    const boxes = [...resultsTable.tbody.querySelectorAll("input[type=checkbox]")];
    return planned.filter((_item, index) => boxes[index]?.checked);
  }

  function updateApplyButton() {
    const count = selectedPlanned().length;
    applyButton.textContent = count
      ? `Apply ${count} split${count === 1 ? "" : "s"}` : "Apply splits";
    applyButton.disabled = count === 0;
  }

  function showPreview(items) {
    planned = items;
    resultsTable.columns[4].label = p1Name.value || "Person 1";
    resultsTable.columns[5].label = p2Name.value || "Person 2";
    const headers = resultsTable.querySelectorAll("th");
    headers[4].textContent = resultsTable.columns[4].label;
    headers[5].textContent = resultsTable.columns[5].label;

    if (!items.length) {
      emptyRow(resultsTable, "Nothing matches the current mappings and dates.");
      resultsHint.textContent =
        "Nothing matches the current mappings and date range.";
      updateApplyButton();
      return;
    }

    clear(resultsTable.tbody);
    for (const item of items) {
      const box = el("input", { type: "checkbox" });
      box.checked = true;
      box.addEventListener("change", updateApplyButton);
      resultsTable.tbody.append(el("tr", {},
        el("td", { class: "check" }, box),
        el("td", { text: item.transaction.date }),
        el("td", { text: `${item.rule.name}  ${item.transaction.payee_name || ""}`.trim() }),
        el("td", { class: "num", text: fmt(item.transaction.amount) }),
        el("td", { class: "num", text: fmt(item.person1Amount) }),
        el("td", { class: "num", text: fmt(item.person2Amount) })));
    }
    resultsHint.textContent =
      `${items.length} transaction(s) match. Untick anything you do not want, ` +
      "then Apply.";
    updateApplyButton();
  }

  function validate() {
    if (!state.token) throw new Error("Connect on the Setup page first.");
    if (!state.budgetId) throw new Error("Select a budget on the Setup page first.");
    const complete = rules.filter(shared.isComplete);
    if (!complete.length) {
      throw new Error("Add at least one shared category mapping before running.");
    }
    return { complete, value: ratio() };
  }

  function backups() {
    const all = store.get("sharedExpenses.backups", {}) || {};
    return all[state.budgetId] || [];
  }

  function saveBackups(list) {
    const all = { ...(store.get("sharedExpenses.backups", {}) || {}) };
    if (list.length) all[state.budgetId] = list;
    else delete all[state.budgetId];
    store.set("sharedExpenses.backups", all);
    paintBackupLabel();
  }

  function paintBackupLabel() {
    const count = backups().length;
    backupLabel.textContent = count
      ? `${count} transaction(s) can be undone.` : "No undo history yet.";
    undoButton.disabled = count === 0;
  }

  async function preview() {
    let checked;
    try {
      checked = validate();
    } catch (error) {
      return log.write(error.message, "error");
    }
    save();

    log.clearLog();
    log.write("Scanning your full transaction history ...", "head");

    const result = await app.run(async () => {
      const fetched = await state.loadAllTransactions();
      if (fetched.cached) {
        log.write(`Using transactions already loaded ${state.dataAge()}. ` +
          "Applying re-reads from YNAB regardless.", "muted");
      }
      return shared.scan(fetched.list, checked.complete, "", "", checked.value,
        { skipAlreadySplit: skipSplit.querySelector("input").checked });
    }, { log, buttons: [previewButton] });

    if (!result) return;
    if (result.skippedAlreadySplit) {
      log.write(`Skipped ${result.skippedAlreadySplit} transaction(s) that ` +
        "are already split.", "muted");
    }
    if (result.skippedTransfers) {
      log.write(`Skipped ${result.skippedTransfers} transfer(s).`, "muted");
    }
    log.write(`Found ${result.planned.length} transaction(s) to convert. ` +
      "Nothing has been changed.", "ok");
    showPreview(result.planned);
  }

  async function applySelected() {
    const chosen = selectedPlanned();
    if (!chosen.length) return;

    const confirmed = await confirmDialog("Apply splits",
      `Convert ${chosen.length} transaction(s) in '${state.budgetName}' into ` +
      "native splits?\n\nThis writes to YNAB. Every change is backed up " +
      "first, so Undo can reverse it.", { confirmText: "Apply" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Applying ${chosen.length} split(s)...`, "head");

    const stored = [...backups()];
    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();

      // The preview may be minutes old. Re-scan and drop anything that
      // changed in YNAB since, rather than overwriting it. Deliberately
      // forced past the cache: the whole point is to see the current truth.
      const { list: fresh } = await state.loadAllTransactions({ force: true });
      const { stillValid, drifted } = shared.driftCheck(
        chosen, fresh, "", "",
        { skipAlreadySplit: skipSplit.querySelector("input").checked });

      for (const { item, reason } of drifted) {
        log.write(`  skipped ${item.transaction.date} ${item.rule.name}: ` +
          `${reason} in YNAB since the preview`, "warn");
      }
      if (!stillValid.length) {
        log.write("Nothing left to convert.", "warn");
        return { changed: 0, failed: 0, applied: [] };
      }

      return shared.applySplits(client, state.budgetId, stillValid, stored, {
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [previewButton, applyButton, undoButton] });

    saveBackups(stored);
    if (!result) return;

    // Patch the cache with exactly what was just written, instead of
    // wiping it and hoping an instant re-fetch already reflects it.
    state.patchTransactions((result.applied || []).map((item) => ({
      id: item.transaction.id,
      patch: {
        category_id: null,
        subtransactions: [
          { category_id: item.rule.person1Id, amount: item.person1Amount },
          { category_id: item.rule.person2Id, amount: item.person2Amount },
        ],
      },
    })));
    state.monthCache.clear();
    state.notify();
    // Without this, a reload straight after Apply pulls back whatever was
    // last persisted to sessionStorage - not this change - since a page
    // reload restores from there instead of asking YNAB again.
    state.persistSession();
    log.write(`Done. Converted ${result.changed} transaction(s).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
    if (result.changed) state.recordRun("sharedExpenses");
    showPreview([]);
    showApplied(result.applied || []);
  }

  async function undo() {
    const stored = backups();
    if (!stored.length) return;

    const chosen = await customDialog("Undo splits", (body) => {
      body.append(hint(
        "These transactions were converted by this app and can be put back " +
        "to a single category. Tick the ones to restore."));
      const undoTable = table([
        { key: "check", label: "", className: "check" },
        { key: "date", label: "Date" },
        { key: "payee", label: "Payee" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      for (const record of stored) {
        const box = el("input", { type: "checkbox" });
        box.checked = true;
        undoTable.tbody.append(el("tr", {},
          el("td", { class: "check" }, box),
          el("td", { text: record.date }),
          el("td", { text: record.payeeName || "(no payee)" }),
          el("td", { class: "num", text: fmt(record.amount) })));
      }
      body.append(undoTable);
      return {
        value: () => {
          const boxes = [...undoTable.tbody.querySelectorAll("input")];
          return stored.filter((_r, index) => boxes[index]?.checked);
        },
      };
    }, { confirmText: "Restore selected" });

    if (!chosen || !chosen.length) return;

    log.clearLog();
    log.write(`Restoring ${chosen.length} transaction(s)...`, "head");

    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();
      return shared.undoFromBackup(client, state.budgetId, stored, {
        ids: chosen.map((record) => record.id),
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [previewButton, applyButton, undoButton] });

    if (!result) return;
    saveBackups(result.remaining);

    // Undo deletes the split and creates a fresh transaction in its place,
    // so the cached copy can't just be patched - the id itself changed.
    if (result.restoredRecords?.length) {
      state.invalidate();
      state.persistSession();
    }
    log.write(`Undo complete. Restored ${result.restored} transaction(s).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
  }

  // ---------- first paint ----------

  paintLabels();
  paintRatio();
  renderRules();
  emptyRow(resultsTable, "Run Preview to see what would change.");
  paintBackupLabel();

  return root;
}
