// Small DOM helpers and the shared widgets. No framework, no dependencies:
// a page holding a financial token is a bad place for a supply chain.

/** el("div", {class: "card"}, child, "text") */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------- icons ----------
//
// One stroked set at a common weight, rather than Unicode glyphs, which come
// from whichever font happens to have them and never match each other.

const ICONS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.6V19a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1V9.6"/>',
  split:
    '<path d="M3 12h4.2l3.4-5H18"/><path d="M7.2 12h.6l3.4 5H18"/>' +
    '<path d="m15.4 4.2 2.8 2.8-2.8 2.8"/><path d="m15.4 14.2 2.8 2.8-2.8 2.8"/>',
  fill:
    '<path d="M12 3.5v10"/><path d="m8 10 4 4 4-4"/>' +
    '<path d="M4.5 16v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V16"/>',
  copies:
    '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/>' +
    '<path d="M15.5 6.5v-1a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/>',
  upload:
    '<path d="M12 15.5V4"/><path d="m8 8 4-4 4 4"/>' +
    '<path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  download:
    '<path d="M12 4v11.5"/><path d="m8 11.5 4 4 4-4"/>' +
    '<path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  info:
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/>' +
    '<circle cx="12" cy="7.75" r=".9" fill="currentColor" stroke="none"/>',
  sheet:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' +
    '<path d="M3.5 9.5h17"/><path d="M9.5 9.5v10"/><path d="M3.5 14.5h17"/>',
  trend:
    '<path d="M4 20V4"/><path d="M4 20h16"/>' +
    '<path d="m7.5 15.5 3.5-4 3 2.5 4.5-6"/>' +
    '<path d="M15 8h3.5v3.5"/>',
  chart:
    '<path d="M4 20V4"/><path d="M4 20h16"/>' +
    '<rect x="7.5" y="12" width="3.2" height="5"/>' +
    '<rect x="13" y="8" width="3.2" height="9"/>',
  settings:
    '<path d="M4 7.5h8"/><path d="M18.5 7.5H20"/><path d="M4 16.5h2.5"/>' +
    '<path d="M13 16.5h7"/><circle cx="15.2" cy="7.5" r="2.6"/>' +
    '<circle cx="9.2" cy="16.5" r="2.6"/>',
  collapse:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' +
    '<path d="M9.5 4.5v15"/><path d="m7.2 10.4-1.8 1.6 1.8 1.6"/>',
  funnel: '<path d="M4 5h16l-6.2 7.5V19l-3.6-2v-4.5z"/>',
  pulse: '<path d="M3 12h4l2.5-7 4 14 2.5-7H21"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/>' +
    '<path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>' +
    '<path d="M8 14h2"/><path d="M14 14h2"/>',
  check:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>' +
    '<path d="m8 12.5 3 3 5.5-6"/>',
  x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  grip:
    '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/>' +
    '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>' +
    '<circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  wallet:
    '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/>' +
    '<path d="M3.5 10h17"/><path d="M15.5 14.5h1.5"/>',
  layout:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
    '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
    '<rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/>',
};

/** An inline SVG icon. Inherits colour, so it works on any background. */
export function icon(name, { size = 20 } = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("width", size);
  node.setAttribute("height", size);
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.7");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  node.innerHTML = ICONS[name] || "";
  return node;
}

// ---------- building blocks ----------

let currentPageIntro = "";

/**
 * The lead paragraph for a page.
 *
 * The title itself lives in the app bar, which stays put while the page
 * scrolls, so printing it again here would only say the same thing twice. It
 * is still emitted for screen readers, which expect the main region to
 * announce its own heading. The description used to print visibly here too,
 * but every page open to that much explanation up front was mostly noise
 * once you already knew the tool - it now lives behind Help instead
 * (`getPageIntro()`, read by `showHelp()` in main.js) rather than on screen.
 */
export function pageHeading(title, intro) {
  currentPageIntro = intro || "";
  return el("div", { class: "page-head" },
    el("h2", { class: "sr-only", text: title }));
}

/** The current page's description, for the Help dialog to show. */
export function getPageIntro() {
  return currentPageIntro;
}

export function card(...children) {
  return el("div", { class: "card" }, ...children);
}

/**
 * A shell for the page's primary actions (Convert, Save, Push, Load...)
 * that sticks just below the topbar as the page scrolls, so a long
 * category table or transaction list never scrolls the actions themselves
 * out of reach. Pass one or more `.card-row` elements as the rows inside -
 * most pages need just one, but a page can stack a second (an account
 * picker plus its own button, say) underneath the first.
 */
export function pageActions(...rows) {
  return el("div", { class: "page-actions" }, ...rows);
}

export function sectionTitle(text) {
  return el("h3", { class: "section-title", text });
}

export function hint(text) {
  return el("p", { class: "hint", text });
}

export function field(labelText, control) {
  return el("div", {}, el("label", { class: "field-label", text: labelText }), control);
}

export function button(text, { accent, danger, small, onClick, disabled } = {}) {
  const classes = ["btn"];
  if (accent) classes.push("btn-accent");
  if (danger) classes.push("btn-danger");
  if (small) classes.push("btn-small");
  return el("button", {
    type: "button",
    class: classes.join(" "),
    text,
    disabled: disabled || false,
    onClick,
  });
}

export function checkbox(labelText, checked, onChange) {
  const input = el("input", { type: "checkbox" });
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "checkbox" }, input, el("span", { text: labelText }));
}

export function radioGroup(name, options, value, onChange) {
  const row = el("div", { class: "radio-row" });
  for (const option of options) {
    const input = el("input", { type: "radio", name });
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener("change", () => onChange(option.value));
    row.append(el("label", {}, input, el("span", { text: option.label })));
  }
  return row;
}

export function textInput(value, { placeholder, type = "text", onInput, width } = {}) {
  const input = el("input", { type, placeholder: placeholder || "" });
  input.value = value ?? "";
  if (width) input.style.maxWidth = width;
  if (onInput) input.addEventListener("input", () => onInput(input.value));
  return input;
}

export function select(options, value, onChange) {
  const node = el("select");
  for (const option of options) {
    node.append(el("option", { value: option.value, text: option.label }));
  }
  node.value = value;
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

// ---------- pill ----------

export function pill(text, kind = "muted") {
  return el("span", { class: `pill pill-${kind}`, text });
}

export function setPill(node, text, kind = "muted") {
  node.className = `pill pill-${kind}`;
  node.textContent = text;
  node.hidden = !text;
}

// ---------- log ----------

export function logPane(placeholder = "") {
  const node = el("div", {
    class: "log",
    role: "log",
    "aria-live": "polite",
    "data-placeholder": placeholder,
  });
  node.write = (message, level = "info") => {
    node.append(el("div", { class: `log-${level}`, text: message }));
    node.scrollTop = node.scrollHeight;
  };
  node.clearLog = () => clear(node);
  return node;
}

// ---------- tables ----------

/**
 * columns: [{ key, label, className, render }]
 * Returns the wrapper; `.tbody` is exposed for row updates.
 */
export function table(columns) {
  const thead = el("thead", {},
    el("tr", {}, columns.map((column) =>
      el("th", { class: column.className || "", text: column.label }))));
  const tbody = el("tbody");
  const node = el("table", {}, thead, tbody);
  const wrap = el("div", { class: "table-wrap" }, node);
  wrap.tbody = tbody;
  wrap.columns = columns;
  return wrap;
}

export function emptyRow(wrap, message) {
  clear(wrap.tbody).append(
    el("tr", { class: "empty-row" },
      el("td", { colspan: String(wrap.columns.length), text: message })));
}

/**
 * Click-to-sort headers on a table() wrapper: each listed column's label
 * becomes a button - first click sorts ascending, every click after flips
 * the direction - with an arrow on the sorted one. Pair with sortRows()
 * (tools/sort.js) when drawing the rows.
 *
 * Works next to a column filter's funnel: the label inside its
 * .th-filter-row is swapped for the button. The <th> itself is never
 * restyled - a sticky header silently stops sticking if its own display
 * changes (see the .filterable-th note in app.css).
 *
 * Returns { sort, setLabel(key, text) }: `sort` is { key, dir } or null,
 * and setLabel renames a header without losing its button (repainting a
 * <th>'s textContent would wipe it).
 */
export function sortableHeaders(wrap, keys, { initial = null, onChange } = {}) {
  const control = { sort: initial };
  const parts = new Map();
  const ths = wrap.querySelectorAll("th");

  function paint() {
    for (const [key, part] of parts) {
      const dir = control.sort?.key === key ? control.sort.dir : null;
      part.arrow.textContent = dir === "asc" ? "▲" : dir === "desc" ? "▼" : "";
      part.th.setAttribute("aria-sort",
        dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none");
      part.button.title = dir === "asc"
        ? `Sorted by ${part.label.textContent}, lowest first - click for highest first`
        : `Sort by ${part.label.textContent}`;
    }
  }

  for (const key of keys) {
    const index = wrap.columns.findIndex((column) => column.key === key);
    if (index < 0) continue;
    const th = ths[index];
    const label = el("span", { text: wrap.columns[index].label || key });
    const arrow = el("span", { class: "sort-arrow", "aria-hidden": "true" });
    const button = el("button", {
      type: "button", class: "th-sort",
      onClick: () => {
        const flip = control.sort?.key === key && control.sort.dir === "asc";
        control.sort = { key, dir: flip ? "desc" : "asc" };
        paint();
        onChange?.(control.sort);
      },
    }, label, arrow);
    const filterRow = th.querySelector(".th-filter-row");
    if (filterRow) {
      filterRow.firstElementChild.replaceWith(button);
    } else {
      th.textContent = "";
      th.append(button);
    }
    parts.set(key, { th, button, label, arrow });
  }

  control.setLabel = (key, text) => {
    const part = parts.get(key);
    if (part) part.label.textContent = text;
    paint();
  };
  paint();
  return control;
}

// ---------- dialogs ----------

const dialog = () => document.getElementById("dialog");

/**
 * The one dialog, reused.
 *
 * Resolution hangs off the form's submit event rather than the dialog's
 * close event. Submit is what actually carries the answer: which button was
 * pressed, and the chance to refuse to close on invalid input. Waiting for
 * close instead means trusting an event that fires after the decision has
 * already been made, and a dialog closed by any other route leaves the
 * promise pending forever.
 */
function openDialog(title, build, {
  confirmText = "OK", cancelText = "Cancel", hideCancel = false, wide = false,
} = {}) {
  const node = dialog();
  const form = node.querySelector("form");
  const cancel = document.getElementById("dialog-cancel");

  node.classList.toggle("is-wide", wide);
  document.getElementById("dialog-title").textContent = title;
  const body = clear(document.getElementById("dialog-body"));
  const result = build ? build(body) : null;

  document.getElementById("dialog-confirm").textContent = confirmText;
  cancel.textContent = cancelText;
  cancel.hidden = hideCancel;

  return new Promise((resolve) => {
    const finish = (value) => {
      form.removeEventListener("submit", onSubmit);
      node.removeEventListener("cancel", onCancel);
      cancel.hidden = false;
      if (node.open) node.close();
      resolve(value);
    };

    function onSubmit(event) {
      const confirmed = event.submitter?.id === "dialog-confirm";
      // A build() that reports invalid input keeps the dialog open, so the
      // message it just wrote is actually readable.
      if (confirmed && result?.validate && result.validate() === false) {
        event.preventDefault();
        return;
      }
      finish(confirmed ? (result?.value?.() ?? true) : null);
    }

    // Escape.
    function onCancel() {
      finish(null);
    }

    form.addEventListener("submit", onSubmit);
    node.addEventListener("cancel", onCancel);
    node.showModal();
  });
}

/** A confirmation. Resolves true only when the confirm button is used. */
export async function confirmDialog(title, message, {
  confirmText = "Continue", cancelText = "Cancel",
} = {}) {
  const answer = await openDialog(title,
    (body) => { body.append(el("p", { text: message })); },
    { confirmText, cancelText });
  return answer === true;
}

export async function alertDialog(title, message, { confirmText = "OK" } = {}) {
  await openDialog(title,
    (body) => { body.append(el("p", { text: message })); },
    { confirmText, cancelText: "", hideCancel: true });
  return true;
}

/**
 * A dialog with arbitrary content. `build(body)` fills it in and returns
 * `{ value, validate }`. When `validate()` returns false the dialog stays
 * open, so the message it just wrote is actually readable.
 */
export function customDialog(title, build, options = {}) {
  return openDialog(title, build, options);
}

// ---------- category picker ----------

/**
 * A field that opens a searchable category list.
 *
 * Selection is by click or Enter only, so the value is always a real
 * category; there is no free-text state to mis-resolve.
 */
export function categoryPicker(state, { onChange } = {}) {
  let items = [];
  let selected = null;
  let popup = null;

  const label = el("span", { class: "label" });
  const fieldButton = el("button", {
    type: "button", class: "picker-field", "aria-haspopup": "listbox",
  }, label, el("span", { class: "caret", text: "▾" }));

  const root = el("div", { class: "picker" }, fieldButton);

  function paint(missing = "") {
    fieldButton.classList.remove("is-placeholder", "is-missing");
    if (selected) {
      const entry = items.find((i) => i.id === selected.id);
      label.textContent = entry ? `${entry.name}   ·   ${entry.group}` : selected.name;
    } else if (missing) {
      label.textContent = `${missing} (not in this budget)`;
      fieldButton.classList.add("is-missing");
    } else {
      label.textContent = "Choose a category...";
      fieldButton.classList.add("is-placeholder");
    }
  }

  function close() {
    if (popup) {
      popup.remove();
      popup = null;
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", follow);
    }
  }

  function onOutside(event) {
    if (!root.contains(event.target) && !popup?.contains(event.target)) close();
  }

  // The popup is fixed in the viewport, so it is moved along with the field
  // when the page (or the table it sits in) scrolls, and closed only once
  // the field itself is off screen. Closing on any scroll or resize at all
  // would close it the moment it opened on a phone: focusing the search box
  // brings up the keyboard, which resizes the window on Android and scrolls
  // the page on iOS. Scrolling its own list is left alone.
  function onScroll(event) {
    if (popup && event.target instanceof Node && popup.contains(event.target)) return;
    follow();
  }

  function follow() {
    if (!popup) return;
    const rect = fieldButton.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) close();
    else place();
  }

  /**
   * Position the popup under the field, in viewport coordinates. It is not
   * a child of the field: a field inside a table sits in a scrolling box
   * (.table-wrap always is one - see the overflow note in app.css) that
   * clips anything poking out, which made the list invisible (a real bug,
   * reported live on Categorize). Flips above the field when there is more
   * room there, and is kept on screen at the right edge.
   */
  function place() {
    const rect = fieldButton.getBoundingClientRect();
    popup.style.position = "fixed";
    popup.style.right = "auto";
    popup.style.minWidth = `${rect.width}px`;
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.top = `${rect.bottom + 6}px`;
    const box = popup.getBoundingClientRect();
    const overflowRight = box.right - (window.innerWidth - 8);
    if (overflowRight > 0) popup.style.left = `${Math.max(8, rect.left - overflowRight)}px`;
    const below = window.innerHeight - rect.bottom;
    if (box.height > below - 14 && rect.top > below) {
      popup.style.top = `${Math.max(8, rect.top - 6 - box.height)}px`;
    }
  }

  function open() {
    if (popup) return close();
    if (!items.length) {
      label.textContent = "No categories loaded";
      return;
    }

    const search = el("input", {
      type: "text", class: "picker-search", placeholder: "Search categories...",
      "aria-label": "Search categories",
    });
    const list = el("ul", { class: "picker-list", role: "listbox" });
    const foot = el("div", { class: "picker-foot" });
    popup = el("div", { class: "picker-popup" }, search, list, foot);
    // Inside a modal dialog the popup has to stay inside it too: anything
    // outside an open modal is unclickable.
    (fieldButton.closest("dialog") || document.body).append(popup);

    let visible = [];
    let cursor = 0;

    function render() {
      const query = search.value.trim().toLowerCase();
      visible = items.filter((item) =>
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.group.toLowerCase().includes(query));

      clear(list);
      visible.forEach((item, index) => {
        list.append(el("li", {
          role: "option",
          "aria-selected": String(index === cursor),
          onClick: () => choose(item),
        }, el("span", { text: item.name }), el("span", { class: "group", text: item.group })));
      });

      foot.textContent = visible.length
        ? `${visible.length} match${visible.length === 1 ? "" : "es"}   ` +
          "Up/Down to move, Enter to pick, Esc to close"
        : "Nothing matches that search";
    }

    function move(delta) {
      if (!visible.length) return;
      cursor = Math.min(visible.length - 1, Math.max(0, cursor + delta));
      render();
      list.children[cursor]?.scrollIntoView({ block: "nearest" });
    }

    function choose(item) {
      selected = { id: item.id, name: item.name };
      paint();
      close();
      onChange?.(selected);
    }

    search.addEventListener("input", () => { cursor = 0; render(); });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Enter") { event.preventDefault(); if (visible[cursor]) choose(visible[cursor]); }
      else if (event.key === "Escape") { event.preventDefault(); close(); fieldButton.focus(); }
    });

    // Preselect whatever is currently chosen.
    cursor = Math.max(0, items.findIndex((i) => i.id === selected?.id));
    render();

    // Placed only now, after render(), since its size depends on the list.
    place();

    search.focus();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", follow);
  }

  fieldButton.addEventListener("click", open);

  root.refresh = () => {
    items = state.flatCategories().map(({ group, category }) => ({
      id: category.id, name: category.name, group,
    }));
    if (selected && !items.some((item) => item.id === selected.id)) selected = null;
    paint();
  };
  root.getCategory = () => selected;
  root.setCategory = (id, fallback = "") => {
    const entry = items.find((item) => item.id === id);
    if (entry) {
      selected = { id: entry.id, name: entry.name };
      paint();
      return true;
    }
    selected = null;
    paint(fallback);
    return false;
  };
  root.clearSelection = () => { selected = null; paint(); };

  root.refresh();
  return root;
}

// ---------- files ----------

export function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept: accept || "" });
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function monthsAgoIso(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

// ---------- month picking ----------
//
// The one month-dropdown component every page with a month picker uses, so
// "March 2026" reads the same everywhere and there is exactly one place
// that decides how far back the list goes.

export function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** "YYYY-MM" for N months before this one. */
export function monthsAgo(n) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" -> "March 2026". */
export function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });
}

/** "YYYY-MM-DD" -> "16 Aug 2026". */
export function dateLabel(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

// However far back is used when a budget has not said when it starts, e.g.
// before a first connection.
const FALLBACK_MONTH_WINDOW = 96;
// A hard stop so a garbled first_month cannot loop this forever.
const MAX_MONTH_OPTIONS = 720;

/**
 * { value, label } options for a month <select>, newest first, going back
 * only as far as the budget itself does.
 */
export function monthOptions(earliestMonth) {
  const options = [];
  const cursor = new Date();
  cursor.setDate(1);
  const stop = earliestMonth || monthsAgo(FALLBACK_MONTH_WINDOW - 1);

  for (let i = 0; i < MAX_MONTH_OPTIONS; i += 1) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    options.push({ value, label: monthLabel(value) });
    if (value <= stop) break;
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return options;
}
