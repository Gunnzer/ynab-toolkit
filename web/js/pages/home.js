// Home: a dashboard of widgets you choose, order and size yourself.
//
// The normal view is just the widgets. "Customize" switches into an edit
// mode (at explicit user request, after the fixed "Needs attention" + tool
// cards page) where each widget gets a size picker, move buttons, a drag
// handle and a remove button, with "Add widgets" and "Reset" alongside.
// Every edit saves straight away; there is nothing to forget to save.
// Drag and drop is the quick way on a computer; the move buttons are there
// because dragging does not work by touch or keyboard.

import * as hl from "../tools/home_layout.js";
import {
  button, card, confirmDialog, customDialog, el, hint, icon, pageHeading, pill, textInput,
} from "../ui.js";
import { drawWidget, widgetAvailable, widgetContext, WIDGETS } from "./home_widgets.js";
import { ownerSelect } from "./report_kit.js";

const BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
// A chart added twice is two copies of one widget type ("categoryChart:x1").
const typeOf = (id) => BY_ID.get(hl.widgetType(id));

/** A widget's name: its own title if one was set, else what it shows. */
function titleOf(widget, config, app) {
  return config?.title || (widget.titleFor ? widget.titleFor(config, app) : widget.title);
}
// Same breakpoint as the phone tier in app.css.
const NARROW = "(max-width: 560px)";

function connectionStatus(state) {
  if (!state.token) {
    return { text: "Add your YNAB access token in Setup to get started.", pill: ["Not connected", "muted"] };
  }
  if (state.connection === "failed") {
    return { text: "YNAB would not accept that token. Check it in Setup.", pill: ["Connection failed", "error"] };
  }
  if (!state.hasBudgetData) {
    return {
      text: state.budgetName
        ? `'${state.budgetName}' is selected but its categories are not loaded.`
        : "Connect and choose a budget to get going.",
      pill: ["No categories", "warn"],
    };
  }
  return null;
}

export function homePage(app) {
  const state = app.state;
  const store = state.store;
  const root = el("div", { class: "page-body home-page" });

  root.append(pageHeading(
    "Home",
    "Your dashboard. Press Customize to choose which widgets show, their " +
    "size and their order - drag them, or use the arrows. A phone keeps a " +
    "layout of its own, since what fits there is different."));

  const problem = connectionStatus(state);
  if (problem) {
    root.append(card(el("div", { class: "card-row" },
      pill(problem.pill[0], problem.pill[1]),
      el("span", { class: "grow", text: problem.text }),
      button("Open Setup", { accent: true, onClick: () => app.go("setup") }))));
  }

  // ---------- layout ----------

  const narrow = window.matchMedia(NARROW).matches;
  const layoutKey = narrow ? "narrow" : "wide";
  const saved = store.get("home.layouts", {}) || {};
  // A phone starts from the computer's layout until it is customized itself.
  let layout = hl.resolveLayout(saved[layoutKey] ?? (narrow ? saved.wide : null), WIDGETS);
  let editing = false;

  const isShown = (id) => widgetAvailable(typeOf(id), app);

  function commit(next) {
    if (next === layout) return;
    layout = next;
    store.set(`home.layouts.${layoutKey}`, layout);
    sync();
  }

  // ---------- toolbar ----------

  const customizeButton = button("Customize", { onClick: () => setEditing(true) });
  customizeButton.prepend(icon("layout", { size: 16 }));
  const addButton = button("Add widgets", { onClick: chooseWidgets });
  addButton.prepend(icon("plus", { size: 16 }));
  const resetButton = button("Reset", { small: true, onClick: reset });
  resetButton.classList.add("btn-link");
  const doneButton = button("Done", { accent: true, onClick: () => setEditing(false) });
  const editNote = hint(`Changes save as you go. This is the ${narrow ? "phone" : "computer"} layout.`);

  // Whose: one choice for every widget at once, remembered between visits.
  // Only once the two people are named - before that the choices are blank.
  let owner = state.peopleNamed ? store.get("home.owner", "all") || "all" : "all";
  const whose = state.peopleNamed && !problem
    ? el("label", { class: "home-whose" },
      el("span", { class: "field-label", text: "Whose" }),
      ownerSelect(state, owner, (value) => {
        owner = value;
        store.set("home.owner", value);
        ctx = widgetContext(app, owner);
        for (const node of nodes.values()) {
          drawWidget(node.widget, node.body, node.dataset.size, ctx, app, JSON.parse(node.dataset.config || "{}"));
        }
      }))
    : null;

  const bar = el("div", { class: "home-bar" },
    whose,
    el("span", { class: "spacer" }),
    editNote, resetButton, addButton, customizeButton, doneButton);
  root.append(bar);

  const grid = el("div", { class: "widget-grid" });
  const emptyNote = card(el("div", { class: "card-row" },
    el("span", { class: "grow", text: "No widgets showing." }),
    button("Add widgets", { accent: true, onClick: chooseWidgets })));
  root.append(grid, emptyNote);

  function setEditing(on) {
    editing = on;
    root.classList.toggle("is-editing", on);
    customizeButton.hidden = on;
    for (const node of [doneButton, addButton, resetButton, editNote]) node.hidden = !on;
    for (const node of nodes.values()) node.draggable = on;
  }

  // ---------- widgets ----------

  let ctx = widgetContext(app, owner);
  // One node per widget, kept across edits, so moving a widget does not
  // reload or redraw anything - only a size change redraws its content.
  const nodes = new Map();

  function sync() {
    const visible = layout.filter((item) => isShown(item.id));
    for (const [id, node] of nodes) {
      if (!visible.some((item) => item.id === id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    visible.forEach((item, index) => {
      let node = nodes.get(item.id);
      if (!node) {
        node = widgetNode(item);
        nodes.set(item.id, node);
      }
      const config = JSON.stringify(item.config || {});
      if (node.dataset.size !== item.size || node.dataset.config !== config) {
        node.dataset.config = config;
        node.paintTitle(item.config);
        resize(node, item.size, item.config);
      }
      node.paintMoves(index > 0, index < visible.length - 1);
      grid.append(node);
    });
    emptyNote.hidden = visible.length > 0;
  }

  function resize(node, size, config) {
    for (const s of hl.SIZES) node.classList.toggle(`size-${s}`, s === size);
    node.dataset.size = size;
    node.paintSize(size);
    drawWidget(node.widget, node.body, size, ctx, app, config);
  }

  /**
   * One settings dialog for every widget: a title (blank means named after
   * what it shows), then whatever options the widget adds (`fields`).
   * Resolves to the new config, or null when cancelled.
   */
  function askSettings(widget, config = {}) {
    return customDialog(`${widget.title} settings`, (body) => {
      const title = textInput(config.title || "", { placeholder: titleOf(widget, { ...config, title: "" }, app) });
      body.append(el("label", { class: "field-label", text: "Title" }), title);
      const extra = widget.fields ? widget.fields(body, config, app) : null;
      return {
        validate: () => (extra?.validate ? extra.validate() : true),
        value: () => ({ ...config, ...(extra ? extra.value() : {}), title: title.value.trim() }),
      };
    }, { confirmText: "Save", wide: Boolean(widget.wideSettings) });
  }

  function widgetNode(item) {
    const id = item.id;
    const widget = typeOf(id);
    const body = el("div", { class: "widget-body" });
    const openable = Boolean(widget.go && (!widget.tool || app.toolEnabled(widget.tool)));
    const open = () => {
      if (widget.tab) store.set("reports.reportTab", widget.tab);
      app.go(widget.go);
    };
    const openLink = openable ? button("Open", { small: true, onClick: open }) : null;
    openLink?.classList.add("btn-link", "widget-open");

    const sizeButtons = new Map(widget.sizes.map((size) => {
      const b = el("button", {
        type: "button", class: "widget-size", text: size.toUpperCase(),
        title: `${hl.SIZE_LABELS[size]} size`, "aria-label": `${hl.SIZE_LABELS[size]} size`,
        onClick: () => commit(hl.setSize(layout, id, size)),
      });
      return [size, b];
    }));
    const tool = (name, label, onClick) => el("button", {
      type: "button", class: "widget-tool", title: label, "aria-label": label, onClick,
    }, icon(name, { size: 16 }));
    const earlier = tool("left", "Move earlier", () => commit(hl.moveWidget(layout, id, -1, isShown)));
    const later = tool("right", "Move later", () => commit(hl.moveWidget(layout, id, 1, isShown)));
    const remove = tool("x", "Remove from Home", () => commit(hl.removeWidget(layout, id)));
    const settings = tool("settings", "Settings", async () => {
      const next = await askSettings(widget, layout.find((entry) => entry.id === id)?.config || {});
      if (next) commit(hl.setConfig(layout, id, next));
    });
    remove.classList.add("is-remove");
    const handle = el("span", { class: "widget-grip", title: "Drag to move", "aria-hidden": "true" },
      icon("grip", { size: 16 }));

    const title = el("h3", { class: "widget-title", text: widget.title });
    const node = el("section", { class: "card widget", "data-widget": widget.id },
      el("header", { class: "widget-head" },
        handle,
        el("span", { class: "widget-icon" }, icon(widget.icon, { size: 16 })),
        title,
        openLink),
      el("div", { class: "widget-edit" },
        el("div", { class: "widget-sizes", role: "group", "aria-label": "Size" }, ...sizeButtons.values()),
        el("span", { class: "spacer" }),
        settings, earlier, later, remove),
      body);
    node.widget = widget;
    node.body = body;
    node.paintTitle = (config) => {
      const text = titleOf(widget, config, app);
      title.textContent = text;
      title.title = text;
      node.setAttribute("aria-label", text);
    };
    // A small widget is one tap target, the usual widget convention: the
    // whole card opens its page, which also leaves its title the room the
    // Open link would take.
    const opensWhole = () => openable && !editing && node.dataset.size === "s";
    node.addEventListener("click", (event) => {
      if (opensWhole() && !event.target.closest("button")) open();
    });
    node.addEventListener("keydown", (event) => {
      if (opensWhole() && event.target === node && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        open();
      }
    });
    node.draggable = editing;
    node.paintSize = (size) => {
      const whole = openable && size === "s";
      node.classList.toggle("is-openable", whole);
      if (whole) {
        node.tabIndex = 0;
        node.setAttribute("role", "link");
      } else {
        node.removeAttribute("tabindex");
        node.removeAttribute("role");
      }
      for (const [s, b] of sizeButtons) {
        b.classList.toggle("is-active", s === size);
        b.setAttribute("aria-pressed", String(s === size));
      }
    };
    node.paintMoves = (canEarlier, canLater) => {
      earlier.disabled = !canEarlier;
      later.disabled = !canLater;
    };
    wireDrag(node, id);
    return node;
  }

  // ---------- drag and drop ----------

  let dragging = null;

  function clearDropMarks() {
    for (const node of nodes.values()) node.classList.remove("drop-before", "drop-after");
  }

  /** Before or after this widget: by the pointer's side for a widget sharing its row, by height for a full-width one. */
  function dropsAfter(node, event) {
    const rect = node.getBoundingClientRect();
    const fullRow = rect.width > grid.getBoundingClientRect().width * 0.7;
    return fullRow ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
  }

  function wireDrag(node, id) {
    node.addEventListener("dragstart", (event) => {
      if (!editing) {
        event.preventDefault();
        return;
      }
      dragging = id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => {
      dragging = null;
      node.classList.remove("is-dragging");
      clearDropMarks();
    });
    node.addEventListener("dragover", (event) => {
      if (!dragging || dragging === id) return;
      event.preventDefault();
      event.stopPropagation();
      const after = dropsAfter(node, event);
      clearDropMarks();
      node.classList.add(after ? "drop-after" : "drop-before");
    });
    node.addEventListener("drop", (event) => {
      if (!dragging || dragging === id) return;
      event.preventDefault();
      event.stopPropagation();
      const visible = layout.filter((item) => isShown(item.id) && item.id !== dragging);
      const at = visible.findIndex((item) => item.id === id);
      const before = dropsAfter(node, event) ? visible[at + 1]?.id ?? null : id;
      const moved = dragging;
      clearDropMarks();
      commit(hl.placeBefore(layout, moved, before));
    });
  }

  // Dropped in the empty space after the last widget: it goes last.
  grid.addEventListener("dragover", (event) => {
    if (dragging && event.target === grid) event.preventDefault();
  });
  grid.addEventListener("drop", (event) => {
    if (!dragging || event.target !== grid) return;
    event.preventDefault();
    commit(hl.placeBefore(layout, dragging, null));
  });

  // ---------- add, remove, reset ----------

  async function chooseWidgets() {
    const chosen = await customDialog("Widgets on Home", (body) => {
      const boxes = new Map();
      const list = el("div", { class: "widget-choices" });
      for (const widget of WIDGETS) {
        const available = widgetAvailable(widget, app);
        const box = el("input", { type: "checkbox" });
        // A chart or a set of links can be on Home more than once: its box
        // adds another copy (each copy is removed with its own x), so it
        // starts unticked.
        const copies = layout.filter((item) => hl.widgetType(item.id) === widget.id).length;
        box.checked = !widget.multi && layout.some((item) => item.id === widget.id);
        box.disabled = !available;
        boxes.set(widget.id, box);
        const page = widget.tool ? pageTitleFor(widget.tool) : "";
        list.append(el("label", { class: `widget-choice ${available ? "" : "is-off"}`.trim() },
          box,
          el("span", { class: "widget-icon" }, icon(widget.icon, { size: 16 })),
          el("span", { class: "widget-choice-text" },
            el("span", { class: "widget-choice-title",
              text: widget.multi ? `${widget.title}: add ${copies ? `another (${copies} on Home)` : "one"}` : widget.title }),
            el("span", { class: "hint", text: available
              ? widget.blurb
              : widget.tool && !app.toolEnabled(widget.tool)
                ? `${widget.blurb} Turn on ${page} in Setup to use it.`
                : `${widget.blurb} Needs a budget loaded.` }))));
      }
      body.append(hint("Tick what shows on Home. New ones go at the end, at their usual size. " +
        "A new chart or set of links asks what to show first."), list);
      return {
        value: () => new Set([...boxes].filter(([, box]) => box.checked).map(([id]) => id)),
      };
    }, { confirmText: "Apply", wide: true });
    if (!chosen) return;

    let next = layout;
    const copies = [];
    for (const widget of WIDGETS) {
      if (!widgetAvailable(widget, app)) continue;
      if (widget.multi) {
        if (chosen.has(widget.id)) copies.push(widget);
        continue;
      }
      const showing = next.some((item) => item.id === widget.id);
      if (chosen.has(widget.id) && !showing) next = hl.addWidget(next, widget);
      if (!chosen.has(widget.id) && showing) next = hl.removeWidget(next, widget.id);
    }
    commit(next);
    // One settings dialog at a time (dialogs here cannot stack); cancelling
    // one just does not add that copy.
    for (const widget of copies) {
      // A new copy starts blank, not from the default layout's "all spending".
      const config = await askSettings(widget, {});
      if (config) commit(hl.addWidget(layout, widget, { config }));
    }
  }

  function pageTitleFor(toolKey) {
    return app.toolPages().find((p) => p.key === toolKey)?.title || "that tool";
  }

  async function reset() {
    const ok = await confirmDialog("Reset Home",
      `Put the ${narrow ? "phone" : "computer"} layout back to the widgets, sizes and order Home starts with?`,
      { confirmText: "Reset" });
    if (ok) commit(hl.defaultLayout(WIDGETS));
  }

  setEditing(false);
  sync();
  return root;
}
