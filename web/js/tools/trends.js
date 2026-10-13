// Category trends: each category's spending over the last 12 full months,
// and which ones have moved most against their own usual.

/**
 * `spending` is spendingByMonth() from budget_actual.js, `months` the full
 * months to cover (oldest first), `categories` the ones to report on
 * ({ id, name, groupName }). "Recent" is the last three months, "usual"
 * the months before that - comparing against an average that already
 * includes the recent months would hide most of a change.
 *
 * A mover has shifted by at least $20 a month and 20% either way.
 */
export function categoryTrends({ spending, months, categories, currentMonth }) {
  const recentCount = Math.min(3, months.length);
  const rows = [];
  for (const category of categories || []) {
    const byMonth = spending.get(category.id);
    const series = months.map((m) => Math.max(0, byMonth?.get(m) || 0));
    if (series.every((v) => v === 0)) continue;

    const recent = series.slice(-recentCount);
    const earlier = series.slice(0, series.length - recentCount);
    const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
    const average = avg(series);
    const recentAvg = avg(recent);
    const usualAvg = earlier.length ? avg(earlier) : recentAvg;
    const change = recentAvg - usualAvg;
    const changePct = usualAvg > 0 ? change / usualAvg : (recentAvg > 0 ? 1 : 0);

    rows.push({
      id: category.id,
      name: category.name,
      groupName: category.groupName || "",
      series,
      average,
      recentAvg,
      usualAvg,
      change,
      changePct,
      thisMonth: Math.max(0, byMonth?.get(currentMonth) || 0),
      mover: Math.abs(change) >= 20000 && Math.abs(changePct) >= 0.2,
    });
  }
  return rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.average - a.average);
}
