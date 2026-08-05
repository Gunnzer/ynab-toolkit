// Shared Expenses: map shared categories, preview, apply, undo.

import { fmt } from "../money.js";
import * as shared from "../tools/shared_expenses.js";
import {
  button, card, categoryPicker, checkbox, clear, confirmDialog, customDialog,
  el, emptyRow, field, hint, logPane, pageHeading, sectionTitle, table,
  textInput, todayIso,
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

  // The two people are defined once, in Setup. Shown here so the split is
  // readable without leaving the page, but not editable from two places.
  const p1Name = textInput(state.personName(1), {});
  const p2Name = textInput(state.personName(2), {});
  p1Name.disabled = true;
  p2Name.disabled = true;
  const p1Pct = textInput(String((settings.person1Ratio ?? 0.35) * 100), {
    onInput: save,
  });
  const startDate = textInput(settings.startDate || defaultStart(), { type: "date", onInput: save });
  const endDate = textInput(settings.endDate || todayIso(), { type: "date", onInput: save });
  const skipSplit = checkbox("Skip transactions that are already split",
    settings.skipAlreadySplit !== false, save);

  // Person 2 always gets the remainder, so it is shown but never typed into.
  const p2Pct = textInput("", { });
  p2Pct.disabled = true;

  const ratioLabel = hint("");

  function defaultStart() {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().slice(0, 10);
  }

  function ratio() {
    const value = Number(p1Pct.value) / 100;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("The share percentage must be a number between 0 and 100.");
    }
    return value;
  }

  function paintRatio() {
    const value = Number(p1Pct.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      p2Pct.value = "";
      ratioLabel.textContent = "Enter a number between 0 and 100.";
      ratioLabel.className = "hint is-error";
      return;
    }
    p2Pct.value = String(100 - value);
    ratioLabel.textContent =
      `${p1Name.value || "Person 1"} ${value}%   /   ` +
      `${p2Name.value || "Person 2"} ${100 - value}%`;
    ratioLabel.className = "hint";
  }

  function save() {
    const value = Number(p1Pct.value) / 100;
    if (Number.isFinite(value)) settings.person1Ratio = value;
    settings.startDate = startDate.value;
    settings.endDate = endDate.value;
    settings.skipAlreadySplit = skipSplit.querySelector("input").checked;
    settings.rules = rules;
    store.save();
    paintLabels();
    // The split line names both people, so it restates whenever a name does.
    paintRatio();
  }

  root.append(card(
    el("div", { class: "card-grid" },
      el("div", { class: "stack" },
        field("Person 1", p1Name), field("Person 1 share (%)", p1Pct)),
      el("div", { class: "stack" },
        field("Person 2", p2Name), field("Person 2 share (%)", p2Pct)),
      el("div", {}, el("span", { class: "field-label", text: "Split" }), ratioLabel)),
    el("div", { class: "card-grid" },
      field("From date", startDate), field("To date", endDate)),
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
    { key: "actions", label: "" },
  ]);

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Shared category mapping"), el("span", { class: "spacer" }),
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
        el("td", {},
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
    resultsTable, resultsHint, log);

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
    if (startDate.value && endDate.value && startDate.value > endDate.value) {
      throw new Error("The From date is after the To date.");
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
    log.write(`Scanning ${startDate.value} to ${endDate.value} ...`, "head");

    const result = await app.run(async () => {
      const fetched = await state.transactions(startDate.value);
      if (fetched.cached) {
        log.write(`Using transactions already loaded ${state.dataAge()}. ` +
          "Applying re-reads from YNAB regardless.", "muted");
      }
      return shared.scan(fetched.list, checked.complete, startDate.value,
        endDate.value, checked.value,
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
      const { list: fresh } = await state.transactions(startDate.value, { force: true });
      const { stillValid, drifted } = shared.driftCheck(
        chosen, fresh, startDate.value, endDate.value,
        { skipAlreadySplit: skipSplit.querySelector("input").checked });

      for (const { item, reason } of drifted) {
        log.write(`  skipped ${item.transaction.date} ${item.rule.name}: ` +
          `${reason} in YNAB since the preview`, "warn");
      }
      if (!stillValid.length) {
        log.write("Nothing left to convert.", "warn");
        return { changed: 0 };
      }

      return shared.applySplits(client, state.budgetId, stillValid, stored, {
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [previewButton, applyButton, undoButton] });

    saveBackups(stored);
    if (!result) return;

    state.invalidate();
    log.write(`Done. Converted ${result.changed} transaction(s).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
    if (result.changed) state.recordRun("sharedExpenses");
    showPreview([]);
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
