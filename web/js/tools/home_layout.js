// Home's widget layout: which widgets show, in what order, at what size.
//
// A layout is an ordered list of { id, size } - a widget not in the list is
// hidden. Pure: the page owns the catalogue of widgets and the DOM, this
// only edits the list, so every edit is a new array (nothing is mutated).
//
// A widget whose tool is switched off stays in the stored layout, just not
// shown, so turning the tool back on puts it back where it was.
//
// Every widget can carry a `config` (its own title, which accounts, which
// categories...). A `multi` widget (a chart, a set of tool links) can be on
// Home more than once: each copy's id is "<type>:<instance>" with its own
// config. Every other widget's id is just its type.

export const SIZES = ["s", "m", "l"];
export const SIZE_LABELS = { s: "Small", m: "Medium", l: "Large" };

/** "categoryChart:k3x9" -> "categoryChart". */
export function widgetType(id) {
  return String(id || "").split(":")[0];
}

/** The out-of-the-box layout: every widget marked `byDefault`, in catalogue order. */
export function defaultLayout(catalog) {
  return catalog.filter((w) => w.byDefault).map((w) => ({
    id: w.multi ? `${w.id}:default` : w.id,
    size: w.defaultSize,
    config: { ...(w.defaultConfig || {}) },
  }));
}

/** The nearest size the widget allows, preferring smaller on a tie. */
function fitSize(widget, size) {
  if (widget.sizes.includes(size)) return size;
  const at = SIZES.indexOf(size);
  const ranked = [...widget.sizes].sort((a, b) =>
    Math.abs(SIZES.indexOf(a) - at) - Math.abs(SIZES.indexOf(b) - at) ||
    SIZES.indexOf(a) - SIZES.indexOf(b));
  return ranked[0] || widget.defaultSize;
}

/**
 * A stored layout made safe to use: unknown widgets (removed in a later
 * version) and repeats dropped, sizes a widget no longer offers moved to
 * the nearest one it does. Nothing stored yet means the default.
 */
export function resolveLayout(saved, catalog) {
  if (!Array.isArray(saved)) return defaultLayout(catalog);
  const byId = new Map(catalog.map((w) => [w.id, w]));
  const seen = new Set();
  const out = [];
  for (const item of saved) {
    const widget = byId.get(widgetType(item?.id));
    if (!widget || seen.has(item.id)) continue;
    // Only a multi widget has instances; a stray "rta:x" is not a second rta.
    if (widget.multi ? item.id === widget.id : item.id !== widget.id) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      size: fitSize(widget, item.size),
      config: item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : {},
    });
  }
  return out;
}

/**
 * Move a widget one place earlier (delta -1) or later (+1) among the ones
 * actually showing - hidden-by-tool widgets in between are stepped over,
 * so one press always visibly moves it.
 */
export function moveWidget(layout, id, delta, isShown = () => true) {
  const from = layout.findIndex((item) => item.id === id);
  if (from < 0) return layout;
  let to = from;
  do { to += delta; } while (to >= 0 && to < layout.length && !isShown(layout[to].id));
  if (to < 0 || to >= layout.length) return layout;
  const out = [...layout];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

/** Drag and drop: put `id` just before `beforeId`, or last when that is null. */
export function placeBefore(layout, id, beforeId) {
  const moving = layout.find((item) => item.id === id);
  if (!moving || id === beforeId) return layout;
  const rest = layout.filter((item) => item.id !== id);
  const at = beforeId ? rest.findIndex((item) => item.id === beforeId) : -1;
  if (at < 0) return [...rest, moving];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

export function setSize(layout, id, size) {
  return layout.map((item) => (item.id === id ? { ...item, size } : item));
}

export function removeWidget(layout, id) {
  return layout.filter((item) => item.id !== id);
}

/**
 * Show a widget, at the end, at its default size. Already showing:
 * unchanged - except a multi widget, which gets another copy with its
 * own `instance` id and `config`.
 */
export function addWidget(layout, widget, { instance = "", config = {} } = {}) {
  if (widget.multi) {
    const id = `${widget.id}:${instance || Math.random().toString(36).slice(2, 8)}`;
    return [...layout, { id, size: widget.defaultSize, config }];
  }
  if (layout.some((item) => item.id === widget.id)) return layout;
  return [...layout, { id: widget.id, size: widget.defaultSize, config: { ...(widget.defaultConfig || {}) } }];
}

export function setConfig(layout, id, config) {
  return layout.map((item) => (item.id === id ? { ...item, config } : item));
}
