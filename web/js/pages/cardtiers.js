// Tier list (at explicit user request: "a tier list of top Canadian credit
// cards, I will update it when needed. Ideally get the info from reddit"):
// the published ranking from the card details file, which anyone can
// rearrange on their own device with Edit. See tools/card_tiers.js.

import { CARDS, POINT_TYPES, TIERS } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue } from "../tools/card_feed.js";
import { shortName } from "../tools/card_rewards.js";
import { moveCard, tierBoard } from "../tools/card_tiers.js";
import { button, card, clear, confirmDialog, el, hint, pageHeading, pill } from "../ui.js";

export function cardTiersPage(app) {
  const store = app.state.store;
  const settings = store.section("cardTiers");
  if (!settings.overrides || typeof settings.overrides !== "object") settings.overrides = {};
  const rewards = store.section("cardRewards");
  let editing = false;

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Tier list",
    "The best Canadian credit cards, ranked from top picks down, with a line " +
    "on what each is good for. The ranking comes from long-running Reddit " +
    "advice (r/PersonalFinanceCanada and r/churningcanada), checked against " +
    "Canadian review sites, and is updated by hand. Edit lets you move cards " +
    "between tiers on this device."));
  const host = el("div", { class: "tier-host" });
  root.append(host);

  const held = () => new Set((rewards.wallet || []).map((w) => w.id));

  function render() {
    clear(host);
    if (!TIERS) {
      host.append(card(hint(CARDS.length ? "No tier list in the card details yet." : "Getting the latest card details...")));
      return;
    }
    const board = tierBoard(TIERS, settings.overrides, CARDS);
    const mine = held();
    const changed = Object.keys(settings.overrides).length;
    const tierIds = board.tiers.map((t) => t.id);

    host.append(card(
      el("div", { class: "tier-head" },
        el("div", {},
          el("h3", { class: "section-title", text: "Top Canadian credit cards" }),
          hint(`Updated ${longDate(TIERS.updated)}. ${TIERS.source}.` +
            (changed ? ` You have moved ${changed} card${changed === 1 ? "" : "s"}.` : ""))),
        el("div", { class: "tier-actions" },
          changed
            ? el("button", {
              type: "button",
              class: "btn btn-small btn-link",
              text: "Reset",
              onClick: async () => {
                if (!(await confirmDialog("Reset the tier list", "Put every card back where the published list has it?", { confirmText: "Reset" }))) return;
                settings.overrides = {};
                store.save();
                render();
              },
            })
            : "",
          button(editing ? "Done" : "Edit", {
            small: true,
            accent: editing,
            onClick: () => {
              editing = !editing;
              render();
            },
          })))));

    for (const tier of board.tiers) {
      if (!tier.cards.length && !editing) continue;
      host.append(el("section", { class: `card tier tier-${tier.id.toLowerCase()}` },
        el("div", { class: "tier-title" },
          el("span", { class: "tier-badge", text: tier.id }),
          el("span", { class: "tier-label", text: tier.label })),
        tier.cards.length
          ? tier.cards.map((entry) => tierRow(entry, tier.id, tierIds, mine))
          : hint("Nothing here.")));
    }
    if (editing && board.unranked.length) {
      host.append(card(
        el("div", { class: "tier-title" },
          el("span", { class: "tier-badge tier-badge-none", text: "-" }),
          el("span", { class: "tier-label", text: "Not ranked" })),
        board.unranked.map((c) => tierRow({ card: c, why: "", moved: false }, "", tierIds, mine))));
    }
  }

  function tierRow({ card: c, why, moved }, tierId, tierIds, mine) {
    const meta = [
      c.annualFee ? `$${Number(c.annualFee).toLocaleString("en-CA")} a year` : "No annual fee",
      POINT_TYPES[c.points]?.name || "",
    ].filter(Boolean).join(" · ");
    const row = el("div", { class: "tier-row" },
      el("div", { class: "reward-name" },
        el("span", { class: "reward-title", text: shortName(c), title: c.name }),
        mine.has(c.id) ? pill("You have it", "ok") : null,
        moved ? pill("Moved by you", "caution") : null),
      el("div", { class: "hint tier-meta", text: meta }),
      why ? el("div", { class: "reward-detail-line", text: why }) : "");
    if (editing) {
      const choice = el("select", { "aria-label": `Tier for ${shortName(c)}` },
        ...tierIds.map((id) => el("option", { value: id, text: `Tier ${id}` })),
        el("option", { value: "", text: "Not ranked" }));
      choice.value = tierId;
      choice.addEventListener("change", () => {
        settings.overrides = moveCard(settings.overrides, TIERS, c.id, choice.value);
        store.save();
        render();
      });
      row.append(el("div", { class: "tier-move" }, choice));
    }
    return row;
  }

  function longDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  }

  render();
  if (!CARDS.length) {
    (async () => {
      let storage = null;
      try { storage = window.localStorage; } catch { storage = null; }
      await loadCatalogue({ fetchJson: browserFetchJson, storage });
      render();
    })();
  }
  return root;
}
