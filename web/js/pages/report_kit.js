// Small pieces shared by the report tabs and the category history dialog.
// Not a page of its own.

import { ownerOf } from "../tools/split_sheet.js";
import { el, select } from "../ui.js";

const SVG = "http://www.w3.org/2000/svg";

export function localMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function localToday(now = new Date()) {
  return `${localMonth(now)}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A headline number with its label, the same look as YNAB Budget's. */
export function stat(label, value, { kind = "", note = "" } = {}) {
  return el("div", { class: "stat" },
    el("span", { class: "stat-label", text: label }),
    el("span", { class: `stat-value ${kind ? `is-${kind}` : ""}`, text: value }),
    note ? el("span", { class: "stat-note", text: note }) : null);
}

/** category id -> its group's name. */
export function groupNameMap(state) {
  const map = new Map();
  for (const group of state.categoryGroups || []) {
    for (const category of group.categories || []) map.set(category.id, group.name);
  }
  return map;
}

// YNAB's own bookkeeping groups: Ready to Assign's inflow category, and
// the credit card payment categories, whose activity is card money moving
// around rather than spending.
const NOT_SPENDING = new Set(["Internal Master Category", "Credit Card Payments"]);

/** Every category you actually budget into, as { id, name, groupName }. */
export function assignableCategories(state, { includeHidden = false } = {}) {
  const out = [];
  for (const group of state.categoryGroups || []) {
    if (group.deleted || NOT_SPENDING.has(group.name)) continue;
    if (group.hidden && !includeHidden) continue;
    for (const category of group.categories || []) {
      if (category.deleted || (category.hidden && !includeHidden)) continue;
      out.push({ id: category.id, name: category.name, groupName: group.name });
    }
  }
  return out;
}

/** The same Everyone / person / Shared choice as the rest of the app. */
export function ownerSelect(state, value, onChange) {
  return select([
    { value: "all", label: "Everyone" },
    { value: "p1", label: state.personName(1) },
    { value: "p2", label: state.personName(2) },
    { value: "shared", label: "Shared" },
  ], value || "all", onChange);
}

export function ownerMatches(state, groupName, owner) {
  if (!owner || owner === "all") return true;
  return ownerOf(groupName, "", state.withPeople({})) === owner;
}

/**
 * A tiny bar chart, one bar per value, for a trend at a glance. The last
 * bar is drawn in the accent colour so "now" is easy to find.
 */
export function sparkline(values, { width = 120, height = 26, label = "" } = {}) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("role", "img");
  if (label) svg.setAttribute("aria-label", label);
  const max = Math.max(1, ...values);
  const gap = 2;
  const barWidth = Math.max(1, (width - gap * (values.length - 1)) / values.length);
  values.forEach((value, index) => {
    const h = value > 0 ? Math.max(2, Math.round((value / max) * (height - 2))) : 1;
    const rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", String(index * (barWidth + gap)));
    rect.setAttribute("y", String(height - h));
    rect.setAttribute("width", String(barWidth));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "1");
    rect.setAttribute("class", index === values.length - 1 ? "spark-bar is-last" : "spark-bar");
    svg.append(rect);
  });
  return svg;
}

/** "+60%" / "-25%", or "" when there is nothing to compare against. */
export function percentText(fraction) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "";
  const pct = Math.round(fraction * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}
