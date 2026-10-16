// Home's charts, drawn as plain SVG (the app has no dependencies).
//
// Built to one set of rules (thin marks, 4px rounded data ends square at
// the baseline, a 2px surface gap between touching marks, solid hairline
// grid, text in text colours never the series colour), with a hover and
// keyboard tooltip on every chart, a legend that writes each series'
// total out (three of the series colours are under 3:1 against the card,
// so the numbers must be readable without them), and a table for screen
// readers. Charts redraw at their real width, so text is never stretched.

import { fmt } from "../money.js";
import { compactMoney, niceTicks } from "../tools/chart_data.js";
import { el } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";
// Fixed order - a series keeps its colour by position, never by rank.
export const SERIES_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--series-${n})`);
export const OTHER_COLOR = "var(--series-other)";

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  return node;
}

/** A rectangle rounded only at its data end (the top), square at the baseline. */
function columnPath(x, y, w, h, radius = 4) {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Draws `render(width)` once laid out, and again whenever the width changes. */
function responsive(host, render) {
  let last = 0;
  let observer = null;
  const draw = () => {
    if (!host.isConnected) {
      if (last) observer?.disconnect();
      return;
    }
    const width = Math.floor(host.clientWidth);
    if (!width || width === last) return;
    last = width;
    render(width);
  };
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => requestAnimationFrame(draw));
    observer.observe(host);
  }
  requestAnimationFrame(draw);
}

function legend(items, { line = false } = {}) {
  return el("div", { class: "chart-legend" }, ...items.map((item) =>
    el("span", { class: "chart-legend-item" },
      el("span", { class: `chart-key ${line ? "is-line" : ""}`.trim(), style: `background:${item.color}` }),
      el("span", { class: "chart-legend-name", text: item.name }),
      item.value ? el("span", { class: "chart-legend-value", text: item.value }) : null)));
}

/**
 * The numbers again as a table, for screen readers. Hidden inside a div:
 * a table ignores the 1px width .sr-only gives it, so on its own a long
 * one (30 days) stretched the whole page sideways.
 */
function srTable(caption, labels, series) {
  return el("div", { class: "sr-only" }, el("table", {},
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, el("th", { text: "" }), ...labels.map((l) => el("th", { text: l })))),
    el("tbody", {}, ...series.map((s) => el("tr", {},
      el("th", { text: s.name }), ...s.values.map((v) => el("td", { text: fmt(v) })))))));
}

function tooltip(plot) {
  const tip = el("div", { class: "chart-tip", role: "status" });
  tip.hidden = true;
  plot.append(tip);
  return {
    show(x, title, rows, total) {
      tip.replaceChildren(
        el("div", { class: "chart-tip-title", text: title }),
        ...rows.map((row) => el("div", { class: "chart-tip-row" },
          el("span", { class: "chart-key is-line", style: `background:${row.color}` }),
          el("strong", { text: row.value }),
          rows.length > 1 || row.name ? el("span", { class: "chart-tip-name", text: row.name }) : null)),
        total ? el("div", { class: "chart-tip-row is-total" }, el("strong", { text: total }), el("span", { text: "in all" })) : null);
      tip.hidden = false;
      const width = plot.clientWidth;
      const tipWidth = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(width - tipWidth, x - tipWidth / 2))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/**
 * Monthly columns. `series` = [{ name, values, color }], one value per
 * label. "stack" piles the series in one column, "group" sets them side by
 * side. `partialLast` paints the last column paler (this month so far).
 * `mini` drops the axes for a small widget's trend.
 */
export function columnChart({
  labels, titles = labels, series, height = 170, mode = "stack", partialLast = false,
  average = null, ariaLabel, mini = false,
}) {
  const plot = el("div", { class: "chart-plot", style: `height:${height}px` });
  const wrap = el("div", { class: "chart" }, plot);
  const tip = tooltip(plot);
  const n = labels.length;
  const k = series.length;
  const value = (s, i) => Math.max(0, s.values[i] || 0);
  const bandTotal = (i) => series.reduce((sum, s) => sum + value(s, i), 0);
  const tops = labels.map((_, i) => (mode === "stack" ? bandTotal(i) : Math.max(0, ...series.map((s) => value(s, i)))));
  const ticks = niceTicks(Math.max(...tops, average || 0));
  const max = ticks[ticks.length - 1];

  responsive(plot, (width) => {
    const padL = mini ? 0 : 46;
    const padR = mini ? 0 : 8;
    const padT = mini ? 2 : 10;
    const padB = mini ? 0 : 22;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const y = (v) => padT + innerH - (v / max) * innerH;
    const band = innerW / n;
    const root = svg("svg", { width, height, role: "img", "aria-label": ariaLabel, class: "chart-svg" });

    if (!mini) {
      for (const tick of ticks) {
        root.append(svg("line", { x1: padL, x2: padL + innerW, y1: y(tick), y2: y(tick), class: tick ? "chart-grid" : "chart-base" }));
        const label = svg("text", { x: padL - 8, y: y(tick) + 4, "text-anchor": "end", class: "chart-axis" });
        label.textContent = compactMoney(tick);
        root.append(label);
      }
      const every = band >= 34 ? 1 : band >= 18 ? 2 : 3;
      labels.forEach((text, i) => {
        if (i % every && i !== n - 1) return;
        const label = svg("text", { x: padL + band * i + band / 2, y: height - 6, "text-anchor": "middle", class: "chart-axis" });
        label.textContent = text;
        root.append(label);
      });
    }

    const highlight = svg("rect", { x: 0, y: padT, width: band, height: innerH, class: "chart-hover", visibility: "hidden" });
    root.append(highlight);

    for (let i = 0; i < n; i += 1) {
      const x0 = padL + band * i;
      const faded = partialLast && i === n - 1;
      const group = svg("g", { opacity: faded ? 0.55 : null });
      if (mode === "stack") {
        const barW = Math.min(mini ? 14 : 24, band * 0.62);
        const x = x0 + (band - barW) / 2;
        let base = 0;
        const parts = series.map((s) => ({ s, v: value(s, i) })).filter((p) => p.v > 0);
        parts.forEach((part, index) => {
          const top = y(base + part.v);
          // The 2px gap sits under every segment but the first.
          const bottom = y(base) - (index ? 2 : 0);
          const h = bottom - top;
          base += part.v;
          if (h <= 0) return;
          const shape = index === parts.length - 1
            ? svg("path", { d: columnPath(x, top, barW, h), fill: part.s.color })
            : svg("rect", { x, y: top, width: barW, height: h, fill: part.s.color });
          group.append(shape);
        });
      } else {
        const room = band * 0.72;
        const barW = Math.min(24, (room - (k - 1) * 2) / k);
        const start = x0 + (band - (barW * k + (k - 1) * 2)) / 2;
        series.forEach((s, j) => {
          const v = value(s, i);
          if (!v) return;
          const top = y(v);
          group.append(svg("path", { d: columnPath(start + j * (barW + 2), top, barW, y(0) - top), fill: s.color }));
        });
      }
      root.append(group);
    }

    if (average && !mini) {
      root.append(svg("line", { x1: padL, x2: padL + innerW, y1: y(average), y2: y(average), class: "chart-average" }));
      const label = svg("text", { x: padL + innerW, y: y(average) - 5, "text-anchor": "end", class: "chart-axis is-strong" });
      label.textContent = `avg ${compactMoney(average)}`;
      root.append(label);
    }

    // Hit targets: the whole band, not just the painted bar.
    for (let i = 0; i < n; i += 1) {
      const x0 = padL + band * i;
      const hit = svg("rect", {
        x: x0, y: 0, width: band, height, fill: "transparent", tabindex: "0", class: "chart-hit",
        "aria-label": `${titles[i]}: ${series.map((s) => `${s.name} ${fmt(s.values[i] || 0)}`).join(", ")}`,
      });
      const show = () => {
        highlight.setAttribute("x", x0);
        highlight.setAttribute("visibility", "visible");
        const rows = series.map((s) => ({ color: s.color, value: fmt(s.values[i] || 0), name: k > 1 ? s.name : "" }));
        tip.show(x0 + band / 2, titles[i] + (partialLast && i === n - 1 ? " so far" : ""), rows,
          mode === "stack" && k > 1 ? fmt(bandTotal(i)) : null);
      };
      const hide = () => {
        highlight.setAttribute("visibility", "hidden");
        tip.hide();
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", show);
      hit.addEventListener("blur", hide);
      root.append(hit);
    }

    plot.querySelector("svg")?.remove();
    plot.prepend(root);
  });

  wrap.append(srTable(ariaLabel, titles, series));
  return wrap;
}

/**
 * Balances over the coming days as stepped lines (a balance changes on a
 * day and holds until the next), with zero drawn firmer when the range
 * crosses it. A crosshair follows the pointer - or the arrow keys - and
 * the tooltip lists every account on that day.
 */
export function lineChart({ dates, titles = dates, series, height = 180, ariaLabel }) {
  const plot = el("div", { class: "chart-plot", style: `height:${height}px` });
  const wrap = el("div", { class: "chart" }, plot);
  const tip = tooltip(plot);
  const n = dates.length;
  const all = series.flatMap((s) => s.values);
  const upTicks = niceTicks(Math.max(1, ...all));
  const top = upTicks[upTicks.length - 1];
  const lowest = Math.min(0, ...all);
  // Below zero gets the same step, so the grid stays even across it.
  const step = upTicks[1];
  const bottom = lowest < 0 ? -Math.ceil(-lowest / step) * step : 0;

  responsive(plot, (width) => {
    const padL = 50;
    const padR = 12;
    const padT = 10;
    const padB = 22;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
    const y = (v) => padT + innerH - ((v - bottom) / (top - bottom)) * innerH;
    const root = svg("svg", { width, height, role: "img", "aria-label": ariaLabel, class: "chart-svg" });

    const ticks = [];
    for (let t = bottom; t <= top; t += step) ticks.push(t);
    for (const tick of ticks) {
      root.append(svg("line", { x1: padL, x2: padL + innerW, y1: y(tick), y2: y(tick), class: tick === 0 ? "chart-base" : "chart-grid" }));
      const label = svg("text", { x: padL - 8, y: y(tick) + 4, "text-anchor": "end", class: "chart-axis" });
      label.textContent = compactMoney(tick);
      root.append(label);
    }
    for (const i of [0, Math.floor((n - 1) / 2), n - 1]) {
      const label = svg("text", {
        x: x(i), y: height - 6, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle", class: "chart-axis",
      });
      label.textContent = dates[i];
      root.append(label);
    }

    for (const s of series) {
      let d = `M${x(0)},${y(s.values[0])}`;
      for (let i = 1; i < n; i += 1) d += `H${x(i)}V${y(s.values[i])}`;
      root.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      root.append(svg("circle", { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4, fill: s.color, class: "chart-dot" }));
    }

    const cross = svg("line", { y1: padT, y2: padT + innerH, class: "chart-cross", visibility: "hidden" });
    const dots = series.map((s) => svg("circle", { r: 4, fill: s.color, class: "chart-dot", visibility: "hidden" }));
    root.append(cross, ...dots);

    let at = -1;
    const showAt = (i) => {
      at = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute("x1", x(at));
      cross.setAttribute("x2", x(at));
      cross.setAttribute("visibility", "visible");
      dots.forEach((dot, j) => {
        dot.setAttribute("cx", x(at));
        dot.setAttribute("cy", y(series[j].values[at]));
        dot.setAttribute("visibility", "visible");
      });
      tip.show(x(at), titles[at], series.map((s) => ({
        color: s.color, value: fmt(s.values[at]), name: series.length > 1 ? s.name : "",
      })));
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      dots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
      tip.hide();
    };
    const overlay = svg("rect", {
      x: padL, y: 0, width: innerW, height, fill: "transparent", tabindex: "0", class: "chart-hit",
      "aria-label": `${ariaLabel}. Use the arrow keys to step through the days.`,
    });
    overlay.addEventListener("pointermove", (event) => {
      const box = overlay.getBoundingClientRect();
      showAt(Math.round(((event.clientX - box.left) / box.width) * (n - 1)));
    });
    overlay.addEventListener("pointerleave", hide);
    overlay.addEventListener("focus", () => showAt(at < 0 ? 0 : at));
    overlay.addEventListener("blur", hide);
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      showAt(at + (event.key === "ArrowRight" ? 1 : -1));
    });
    root.append(overlay);

    plot.querySelector("svg")?.remove();
    plot.prepend(root);
  });

  wrap.append(srTable(ariaLabel, titles, series));
  return wrap;
}

export { legend as chartLegend };
