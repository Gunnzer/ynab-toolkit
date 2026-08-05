// Auto Assign: drain a holding category into targeted categories.

import { fmt } from "../money.js";
import * as autoassign from "../tools/autoassign.js";
import {
  button, card, categoryPicker, clear, confirmDialog, customDialog, el,
  emptyRow, field, hint, logPane, pageHeading, radioGroup, sectionTitle,
  table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing run yet. Preview first to see exactly where the money would go " +
  "before anything is assigned.";

export function autoAssignPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("autoAssign");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);
  let plan = null;

  root.append(pageHeading(
    "Auto Assign",
    "Moves money out of a holding category and into your targeted " +
    "categories, group by group in the priority order you set, until the " +
    "holding category runs dry."));

  // ---------- settings ----------

  const holdingPick = categoryPicker(state, {
    onChange: (chosen) => {
      settings.holdingCategoryId = chosen.id;
      settings.holdingCategoryName = chosen.name;
      store.save();
    },
  });

  const monthInput = textInput(
    settings.month !== "current" ? settings.month : thisMonth(),
    { type: "month", onInput: saveSettings });

  const monthMode = radioGroup("month-mode", [
    { value: "current", label: "This month" },
    { value: "specific", label: "Specific" },
  ], settings.month === "current" ? "current" : "specific", (value) => {
    monthInput.disabled = value === "current";
    saveSettings();
  });
  monthInput.disabled = settings.month === "current";

  const basisMode = radioGroup("basis", [
    { value: autoassign.BASIS_UNDERFUNDED, label: "Underfunded this month" },
    { value: autoassign.BASIS_TARGET, label: "Target minus assigned" },
  ], settings.basis || autoassign.BASIS_UNDERFUNDED, saveSettings);

  function thisMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  function currentMonth() {
    const mode = monthMode.querySelector("input:checked").value;
    return mode === "current" ? thisMonth() : monthInput.value;
  }

  function currentBasis() {
    return basisMode.querySelector("input:checked").value;
  }

  function saveSettings() {
    const mode = monthMode.querySelector("input:checked").value;
    monthInput.disabled = mode === "current";
    settings.month = mode === "current" ? "current" : monthInput.value;
    settings.basis = currentBasis();
    store.save();
    paintBackupLabel();
  }

  root.append(card(
    field("Holding category", holdingPick),
    el("div", {},
      el("span", { class: "field-label", text: "Month" }),
      el("div", { class: "inline" }, monthMode, el("div", { class: "narrow" }, monthInput))),
    el("div", {},
      el("span", { class: "field-label", text: "Amount needed" }), basisMode),
    hint("'Underfunded this month' matches the figure YNAB itself shows, and " +
      "understands goal cadence and due dates. 'Target minus assigned' is " +
      "the simpler arithmetic.")));

  // ---------- groups ----------

  const groupList = el("div", { class: "table-wrap" });

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Category groups to fund, in priority order"),
      el("span", { class: "spacer" }),
      button("Add groups", { small: true, onClick: addGroups })),
    groupList,
    hint("Groups at the top are funded first. Only categories that have a " +
      "target set are funded."));

  function renderGroups() {
    const ids = settings.groupIds || [];
    const names = settings.groupNames || [];
    clear(groupList);

    if (!ids.length) {
      groupList.append(el("p", {
        class: "hint", style: "padding:18px;text-align:center",
        text: "No groups chosen yet. Press Add groups.",
      }));
      return;
    }

    const list = el("table");
    const body = el("tbody");
    ids.forEach((id, index) => {
      const name = state.hasBudgetData
        ? state.groupName(id, names[index] || "(missing group)")
        : (names[index] || id);
      body.append(el("tr", {},
        el("td", { text: `${index + 1}.` , style: "width:44px" }),
        el("td", { text: name }),
        el("td", { style: "width:210px" },
          el("div", { class: "inline" },
            button("Up", { small: true, disabled: index === 0, onClick: () => move(index, -1) }),
            button("Down", { small: true, disabled: index === ids.length - 1, onClick: () => move(index, 1) }),
            button("Remove", { small: true, danger: true, onClick: () => removeGroup(index) })))));
    });
    list.append(body);
    groupList.append(list);
  }

  function setGroups(ids, names) {
    settings.groupIds = ids;
    settings.groupNames = names;
    store.save();
    renderGroups();
  }

  function move(index, delta) {
    const ids = [...(settings.groupIds || [])];
    const names = [...(settings.groupNames || [])];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    if (names.length === ids.length) [names[index], names[target]] = [names[target], names[index]];
    setGroups(ids, names);
  }

  function removeGroup(index) {
    const ids = [...(settings.groupIds || [])];
    const names = [...(settings.groupNames || [])];
    ids.splice(index, 1);
    names.splice(index, 1);
    setGroups(ids, names);
  }

  async function addGroups() {
    if (!state.hasBudgetData) {
      return log.write("Load a budget on the Setup page first.", "warn");
    }
    const existing = new Set(settings.groupIds || []);
    const available = state.groups().filter((group) => !existing.has(group.id));
    if (!available.length) {
      return log.write("Every group is already in the list.", "muted");
    }

    const chosen = await customDialog("Add category groups", (body) => {
      body.append(hint("Tick the groups to fund."));
      const boxes = [];
      const wrap = el("div", { style: "max-height:320px;overflow-y:auto" });
      for (const group of available) {
        const box = el("input", { type: "checkbox" });
        boxes.push(box);
        wrap.append(el("label", { class: "checkbox", style: "padding:4px 0" },
          box, el("span", { text: group.name })));
      }
      body.append(wrap);
      return {
        value: () => available.filter((_group, index) => boxes[index].checked),
      };
    }, { confirmText: "Add selected" });

    if (!chosen || !chosen.length) return;
    setGroups(
      [...(settings.groupIds || []), ...chosen.map((group) => group.id)],
      [...(settings.groupNames || []), ...chosen.map((group) => group.name)]);
  }

  // ---------- actions ----------

  const previewButton = button("Preview (no changes)", { onClick: preview });
  const applyButton = button("Assign money", { accent: true, onClick: apply });
  const undoButton = button("Undo last run", { danger: true, onClick: undo });
  const backupLabel = hint("");

  root.append(el("div", { class: "card-row" },
    previewButton, applyButton, undoButton, backupLabel));

  const planTable = table([
    { key: "group", label: "Group" },
    { key: "category", label: "Category" },
    { key: "from", label: "Assigned now", className: "num" },
    { key: "to", label: "After", className: "num" },
    { key: "amount", label: "Added", className: "num" },
  ]);

  root.append(sectionTitle("Plan"), planTable, log);

  function backupFor(month) {
    const all = store.get("autoAssign.backups", {}) || {};
    return all[`${state.budgetId}|${month}`] || null;
  }

  function saveBackup(month, record) {
    const all = { ...(store.get("autoAssign.backups", {}) || {}) };
    const key = `${state.budgetId}|${month}`;
    if (record) all[key] = record;
    else delete all[key];
    store.set("autoAssign.backups", all);
    paintBackupLabel();
  }

  function paintBackupLabel() {
    const record = backupFor(currentMonth());
    const count = record?.categories?.length || 0;
    backupLabel.textContent = count
      ? `${count} categor(ies) can be put back.`
      : "No undo history for this month.";
    undoButton.disabled = count === 0;
  }

  function validate() {
    if (!state.token) throw new Error("Connect on the Setup page first.");
    if (!state.budgetId) throw new Error("Select a budget on the Setup page first.");
    if (!settings.holdingCategoryId) throw new Error("Choose a holding category first.");
    if (!(settings.groupIds || []).length) {
      throw new Error("Add at least one category group to fund.");
    }
    const month = currentMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a valid month.");
    return month;
  }

  function showPlan(built) {
    plan = built;
    if (!built || !built.allocations.length) {
      emptyRow(planTable, built?.reason || "Nothing to assign.");
      applyButton.disabled = true;
      return;
    }
    clear(planTable.tbody);
    for (const allocation of built.allocations) {
      planTable.tbody.append(el("tr", {},
        el("td", { text: allocation.groupName }),
        el("td", { text: allocation.categoryName }),
        el("td", { class: "num", text: fmt(allocation.currentBudgeted) }),
        el("td", { class: "num", text: fmt(allocation.newBudgeted) }),
        el("td", { class: "num", text: fmt(allocation.amount) })));
    }
    applyButton.disabled = false;
  }

  async function buildPlan(month) {
    const client = state.requireClient();
    const monthData = await client.month(state.budgetId, month);
    const names = Object.fromEntries(
      (settings.groupIds || []).map((id) => [id, state.groupName(id, "")]));
    return autoassign.buildPlan(
      monthData.categories || [], settings.groupIds, settings.holdingCategoryId,
      { basis: currentBasis(), groupNamesById: names });
  }

  async function preview() {
    let month;
    try {
      month = validate();
    } catch (error) {
      return log.write(error.message, "error");
    }

    log.clearLog();
    log.write(`Reading budget month ${month} ...`, "head");

    const built = await app.run(() => buildPlan(month),
      { log, buttons: [previewButton] });
    if (!built) return;

    if (built.reason && !built.allocations.length) log.write(built.reason, "warn");
    else {
      log.write(`Holding has ${fmt(built.holdingAvailable)} available across ` +
        `${built.considered} targeted categor(ies).`);
      log.write(`Would allocate ${fmt(built.totalAllocated)}, leaving ` +
        `${fmt(built.remaining)}. Nothing has been changed.`, "ok");
    }
    showPlan(built);
  }

  async function apply() {
    let month;
    try {
      month = validate();
    } catch (error) {
      return log.write(error.message, "error");
    }
    if (!plan || !plan.allocations.length) {
      return log.write("Run Preview first.", "warn");
    }

    const confirmed = await confirmDialog("Assign money",
      `Move ${fmt(plan.totalAllocated)} out of ` +
      `'${settings.holdingCategoryName}' in '${state.budgetName}' for ` +
      `${month}?\n\nThis changes your budget. Undo last run can put it back.`,
      { confirmText: "Assign" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Assigning for ${month} ...`, "head");

    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();
      // Record the previous amounts before touching anything.
      saveBackup(month, autoassign.makeBackup(month, plan, settings.holdingCategoryId));
      return autoassign.applyPlan(
        client, state.budgetId, month, plan, settings.holdingCategoryId,
        { log: (message, level) => log.write(message, level), shouldStop });
    }, { log, buttons: [previewButton, applyButton, undoButton] });

    if (!result) return;
    log.write(`Allocated ${fmt(result.moved)} into ${result.applied} ` +
      `categor(ies).` + (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
    if (result.applied) state.recordRun("autoAssign");
    showPlan(null);
    paintBackupLabel();
  }

  async function undo() {
    const month = currentMonth();
    const record = backupFor(month);
    if (!record) return;

    const confirmed = await confirmDialog("Undo Auto Assign",
      `Put ${record.categories.length} categor(ies) back to the amounts they ` +
      `had before the last run in ${month}?\n\nThis rewrites your budget.`,
      { confirmText: "Undo" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Restoring ${month} ...`, "head");

    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();
      return autoassign.undoFromBackup(client, state.budgetId, record, {
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [previewButton, applyButton, undoButton] });

    if (!result) return;
    log.write(`Undo complete. Restored ${result.restored} categor(ies).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
    if (!result.failed) saveBackup(month, null);
  }

  // ---------- first paint ----------

  if (settings.holdingCategoryId) {
    holdingPick.setCategory(settings.holdingCategoryId, settings.holdingCategoryName);
  }
  renderGroups();
  emptyRow(planTable, "Run Preview to see where the money would go.");
  applyButton.disabled = true;
  paintBackupLabel();

  return root;
}
