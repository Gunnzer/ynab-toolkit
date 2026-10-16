// Shaping data for Home's chart widgets. Pure: no DOM, milliunits in and
// out. The drawing lives in pages/home_charts.js.

/** Budget groups a person can pick from: not YNAB's internal one or card payments. */
function pickableGroups(categoryGroups) {
  return (categoryGroups || []).filter((g) => !g.deleted &&
    g.name !== "Internal Master Category" && g.name !== "Credit Card Payments");
}

/**
 * The groups a selection names: every one when `all` is set (so a group
 * added to the budget later shows up on its own), else the chosen ones.
 */
function chosenGroups(selection, categoryGroups) {
  if (selection?.all) return new Set(pickableGroups(categoryGroups).map((g) => g.id));
  return new Set(selection?.groupIds || []);
}

/**
 * The categories a chart covers. A chosen group means every category in
 * it as the budget stands now, so a category added to the group later is
 * picked up without editing the chart.
 */
export function selectedCategoryIds(selection, categoryGroups) {
  const ids = new Set(selection?.categoryIds || []);
  const groups = chosenGroups(selection, categoryGroups);
  for (const group of pickableGroups(categoryGroups)) {
    if (!groups.has(group.id)) continue;
    for (const category of group.categories || []) if (!category.deleted) ids.add(category.id);
  }
  return ids;
}

/** What a chart shows, in words: "Groceries, Dining Out and 2 more". */
export function selectionName(selection, categoryGroups) {
  if (selection?.all) return "All spending";
  const names = [];
  const groups = chosenGroups(selection, categoryGroups);
  const categories = new Set(selection?.categoryIds || []);
  for (const group of pickableGroups(categoryGroups)) {
    if (groups.has(group.id)) names.push(group.name);
    for (const category of group.categories || []) {
      if (categories.has(category.id) && !groups.has(group.id)) names.push(category.name);
    }
  }
  if (!names.length) return "";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ");
}

/**
 * Monthly spending series for a chart. `spending` is spendingByMonth()'s
 * map (category id -> month -> spent). Combined: one series. Separate: one
 * per chosen group or category (a category inside a chosen group is part
 * of that group's series, never counted twice), and past `maxSeries` the
 * smallest fold into one "Other" - a chart never gets more colours than
 * it can keep apart.
 */
export function spendingSeries({ spending, selection, categoryGroups, months, separate = false, maxSeries = 6 }) {
  const valuesFor = (ids) => months.map((month) =>
    [...ids].reduce((sum, id) => sum + (spending.get(id)?.get(month) || 0), 0));

  if (!separate) {
    const ids = selectedCategoryIds(selection, categoryGroups);
    return [{ key: "total", name: selectionName(selection, categoryGroups) || "Spending", values: valuesFor(ids) }];
  }

  const groups = chosenGroups(selection, categoryGroups);
  const categories = new Set(selection?.categoryIds || []);
  const series = [];
  for (const group of pickableGroups(categoryGroups)) {
    if (groups.has(group.id)) {
      const ids = (group.categories || []).filter((c) => !c.deleted).map((c) => c.id);
      series.push({ key: `group:${group.id}`, name: group.name, values: valuesFor(ids) });
      continue;
    }
    for (const category of group.categories || []) {
      if (categories.has(category.id)) {
        series.push({ key: `category:${category.id}`, name: category.name, values: valuesFor([category.id]) });
      }
    }
  }
  // A group or category with nothing spent in the whole period is noise
  // in a legend, and a colour slot taken for nothing.
  const spent = series.filter((s) => s.values.some((v) => v !== 0));
  if (spent.length) series.splice(0, series.length, ...spent);
  if (series.length <= maxSeries) return series;

  const total = (s) => s.values.reduce((a, b) => a + b, 0);
  const ranked = [...series].sort((a, b) => total(b) - total(a));
  const kept = new Set(ranked.slice(0, maxSeries - 1).map((s) => s.key));
  const rest = series.filter((s) => !kept.has(s.key));
  return [
    // Kept in budget order, so a series keeps its colour as the others change.
    ...series.filter((s) => kept.has(s.key)),
    {
      key: "other",
      name: `Other (${rest.length})`,
      other: true,
      values: months.map((_, i) => rest.reduce((sum, s) => sum + s.values[i], 0)),
    },
  ];
}

/**
 * An account's balance at the end of each day from `today` for `days`
 * days, from forecastAccounts()'s events (each carrying balanceAfter).
 */
export function dailyBalances(account, today, days) {
  const [y, m, d] = today.split("-").map(Number);
  const out = [];
  let balance = account.start;
  let next = 0;
  const events = account.events || [];
  for (let n = 0; n <= days; n += 1) {
    const when = new Date(y, m - 1, d + n);
    const iso = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
    while (next < events.length && events[next].date <= iso) {
      balance = events[next].balanceAfter;
      next += 1;
    }
    out.push({ date: iso, balance });
  }
  return out;
}

/** A round number at or above `value` for an axis top: 1, 2, 2.5 or 5 times a power of ten. */
export function niceCeiling(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/**
 * Round axis ticks from 0 up past `max`: about `count` equal steps, each a
 * round number (so 0 / 1K / 2K / 3K, never a $1.3K halfway mark). Never
 * finer than `minStep` - a dollar, in milliunits - so an empty chart does
 * not get fractions of a cent up its side.
 */
export function niceTicks(max, count = 3, minStep = 1000) {
  const step = Math.max(minStep, niceCeiling(Math.max(max, 1) / count));
  const steps = Math.max(1, Math.ceil(Math.max(max, 1) / step));
  return Array.from({ length: steps + 1 }, (_, i) => i * step);
}

/** Axis money: $0, $850, $1.2K, $12K, $1.5M - milliunits in. */
export function compactMoney(milliunits) {
  const dollars = milliunits / 1000;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  const trim = (n) => String(Number(n.toFixed(1)));
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}
