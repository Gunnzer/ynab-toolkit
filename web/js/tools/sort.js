// Sorting rows for a click-to-sort table column.

function blank(value) {
  return value === null || value === undefined || value === "" ||
    (typeof value === "number" && Number.isNaN(value));
}

/**
 * `rows` sorted by `sort` ({ key, dir: "asc" | "desc" }), reading each
 * value with `valueOf(row, key)`. Numbers compare as numbers, dates by
 * time, text naturally and ignoring case ("Item 2" before "Item 10").
 * Blank values always go last, whichever way it is sorted. Ties keep their
 * original order. No sort returns the rows unchanged.
 */
export function sortRows(rows, sort, valueOf = (row, key) => row[key]) {
  if (!sort?.key) return rows;
  const factor = sort.dir === "desc" ? -1 : 1;
  const norm = (value) => (value instanceof Date ? value.getTime() : value);
  return rows
    .map((row, index) => ({ row, index, value: norm(valueOf(row, sort.key)) }))
    .sort((a, b) => {
      const aBlank = blank(a.value);
      const bBlank = blank(b.value);
      if (aBlank || bBlank) return aBlank === bBlank ? a.index - b.index : aBlank ? 1 : -1;
      const cmp = typeof a.value === "number" && typeof b.value === "number"
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
      return cmp * factor || a.index - b.index;
    })
    .map((item) => item.row);
}
