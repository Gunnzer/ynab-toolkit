// Home: where you are, what is ready, and one click into each tool.

import {
  button, card, el, hint, icon, pageHeading, pill, sectionTitle,
} from "../ui.js";

function ago(iso) {
  if (!iso) return null;
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return null;

  const seconds = Math.max(0, (Date.now() - when) / 1000);
  const days = Math.floor(seconds / 86400);
  if (days > 1) return `${days} days ago`;
  if (days === 1) return "yesterday";
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

/** A one-line readiness summary, so a card is more than a link. */
function toolStatus(app, key) {
  const store = app.state.store;

  if (key === "budgetOverview") {
    if (!app.state.hasBudgetData) return ["No budget loaded yet", "warn"];
    const groups = app.state.groups().length;
    return [`${app.state.flatCategories().length} categories in ` +
      `${groups} group${groups === 1 ? "" : "s"}`, "ok"];
  }

  if (key === "sharedExpenses") {
    const rules = store.get("sharedExpenses.rules", []) || [];
    if (!rules.length) return ["No category mappings yet", "warn"];
    const backups = store.get("sharedExpenses.backups", {}) || {};
    const undo = (backups[app.state.budgetId] || []).length;
    let text = `${rules.length} mapping${rules.length === 1 ? "" : "s"}`;
    if (undo) text += `, ${undo} change${undo === 1 ? "" : "s"} undoable`;
    return [text, "ok"];
  }

  if (key === "splitSheet") {
    if (!app.state.peopleNamed) return ["The two people are not named yet", "warn"];
    return [`${app.state.personName(1)} and ${app.state.personName(2)}`, "ok"];
  }

  if (key === "autoAssign") {
    const section = store.section("autoAssign");
    if (!section.holdingCategoryId) return ["No holding category chosen", "warn"];
    const groups = section.groupIds || [];
    if (!groups.length) return ["No category groups chosen", "warn"];
    return [`${section.holdingCategoryName} into ${groups.length} ` +
      `group${groups.length === 1 ? "" : "s"}`, "ok"];
  }

  if (key === "duplicates") {
    const section = store.section("duplicates");
    return [`Looks ${section.withinDays} day(s) either side`, "ok"];
  }

  if (key === "bankImport") {
    const rules = store.get("bankImport.payeeRules", []) || [];
    const active = rules.filter((rule) => rule.enabled !== false).length;
    return [`${active} payee rule${active === 1 ? "" : "s"} active`, "ok"];
  }

  return ["", "muted"];
}

export function homePage(app) {
  const state = app.state;
  const root = el("div", { class: "page-body" });

  root.append(pageHeading(
    "YNAB Toolkit",
    "Utilities for the parts of YNAB that need doing by hand. Everything " +
    "runs in your browser."));

  // ---------- status ----------

  let statusText;
  let statusKind;
  let action = null;

  if (!state.token) {
    statusText = "Add your YNAB access token in Setup to get started.";
    statusKind = ["Not connected", "muted"];
    action = "Open Setup";
  } else if (state.connection === "failed") {
    statusText = "YNAB would not accept that token. Check it in Setup.";
    statusKind = ["Connection failed", "error"];
    action = "Open Setup";
  } else if (!state.hasBudgetData) {
    statusText = state.budgetName
      ? `'${state.budgetName}' is selected but its categories are not loaded.`
      : "Connect and choose a budget to get going.";
    statusKind = ["No categories", "warn"];
    action = "Open Setup";
  } else {
    const count = state.flatCategories().length;
    statusText = `Connected. ${count} categories loaded` +
      (state.rateLimit ? `, ${state.rateLimit} API calls used this hour.` : ".");
    statusKind = [state.budgetName, "ok"];
  }

  root.append(card(el("div", { class: "card-row" },
    pill(statusKind[0], statusKind[1]),
    el("span", { class: "grow", text: statusText }),
    action ? button(action, { accent: true, onClick: () => app.go("setup") }) : null)));

  // ---------- tools ----------

  root.append(sectionTitle("Your tools"));

  const pages = app.enabledToolPages();
  if (!pages.length) {
    root.append(card(
      el("p", { text: "Every tool is switched off." }),
      hint("Turn the ones you use back on under Setup.")));
    return root;
  }

  const lastRun = state.store.get("tools.lastRun", {}) || {};
  const grid = el("div", { class: "tool-grid" });

  for (const page of pages) {
    const [text, kind] = toolStatus(app, page.key);
    const when = ago(lastRun[page.key]);
    const tile = card(
      el("div", { class: "tool-card-title" },
        el("span", { class: "tool-icon" }, icon(page.icon, { size: 22 })),
        el("h3", { class: "section-title", text: page.title })),
      hint(page.blurb),
      el("div", { class: "tool-card-foot" },
        el("p", { class: `status-line is-${kind === "ok" ? "ok" : "warn"}`, text }),
        when ? hint(`Last run ${when}`) : null,
        button(`Open ${page.title}`, { onClick: () => app.go(page.id) })));
    tile.classList.add("tool-card");
    grid.append(tile);
  }

  root.append(grid);
  return root;
}
