// My cards: what each card in your wallet costs and earns, at a glance (at
// explicit user request: "a my card page where you can add and setup your
// cards and you'll see an image of the card with details like fee, upcoming
// fee increase, rewards per group or type"). The wallet itself is
// cardRewards.wallet, shared with Best card, Welcome bonuses and the Tier
// list; this page is the one place it is changed.

import { PERK_KINDS, centsPerPoint, describeEarn } from "./card_rewards.js";

// Colour of the drawn card. Each name is a gradient in app.css
// (`.card-face[data-face=...]`); a plain colour family, not an issuer's
// artwork. Cards not listed take their issuer's, then their network's.
const FACE_BY_CARD = {
  "amex-cobalt": "blue",
  "amex-gold": "gold",
  "amex-platinum": "silver",
  "amex-aeroplan": "charcoal",
  "amex-aeroplan-reserve": "black",
  "amex-simplycash-preferred": "navy",
  "amex-simplycash": "sky",
  "marriott-bonvoy-amex": "charcoal",
  "td-aeroplan-vi": "charcoal",
  "td-aeroplan-vip": "black",
  "cibc-aeroplan-vi": "charcoal",
  "cibc-aeroplan-vip": "black",
  "scotia-gold-amex": "gold",
  "scotia-platinum-amex": "silver",
  "scotia-passport-vi": "navy",
  "scotia-momentum-vi": "plum",
  "pc-world-elite": "black",
  "rogers-red-we": "red",
  "bmo-cashback-we": "navy",
  "bmo-eclipse-vi": "black",
  "bmo-eclipse-vip": "black",
  "rbc-avion-vi": "navy",
  "cibc-dividend-vi": "teal",
  "td-first-class-vi": "charcoal",
  "td-cashback-vi": "green",
  "cibc-costco-mc": "charcoal",
  "tangerine-mc": "orange",
  "mbna-rewards-we": "rose",
};
const FACE_BY_ISSUER = {
  "American Express": "blue",
  TD: "green",
  CIBC: "red",
  Scotiabank: "red",
  BMO: "navy",
  RBC: "navy",
  "Rogers Bank": "red",
  Tangerine: "orange",
  MBNA: "plum",
  "PC Financial": "black",
};
const FACE_BY_NETWORK = { amex: "blue", visa: "navy", mastercard: "charcoal" };

export const FACES = ["blue", "navy", "sky", "gold", "silver", "black", "charcoal", "red", "green", "teal", "orange", "plum", "rose"];
// Faces light enough to need dark writing.
export const LIGHT_FACES = new Set(["gold", "silver", "sky"]);

/** The colour family to draw a card in. A card typed in by hand can pick its own. */
export function cardFace(card) {
  if (FACES.includes(card?.face)) return card.face;
  return FACE_BY_CARD[card?.id] || FACE_BY_ISSUER[card?.issuer] || FACE_BY_NETWORK[card?.network] || "charcoal";
}

/**
 * The yearly fee now and any announced change:
 *   { fee, change: { fee, from, detail, upcoming, diff } | null }
 * `upcoming` is false once `from` has passed (it then applies at your next
 * renewal, if it has not already).
 */
export function feeInfo(card, today) {
  const fee = Number(card?.annualFee) || 0;
  const c = card?.feeChange;
  if (!c || typeof c.fee !== "number" || !c.from) return { fee, change: null };
  return {
    fee,
    change: { fee: c.fee, from: c.from, detail: c.detail || "", upcoming: !today || c.from > today, diff: Math.round((c.fee - fee) * 100) / 100 },
  };
}

/**
 * What the card earns on each kind of purchase, best first, with "Everything
 * else" last: describeEarn()'s lines, each with `back`, the cents back per
 * $1 (a percent) at the holder's point values. Lines for the same purchases
 * under different conditions stay separate, in the card's own order.
 */
export function earnLines(card, values = {}) {
  const cents = centsPerPoint(card.points, values);
  const lines = describeEarn(card).map((line, index) => ({
    ...line,
    back: Math.round(line.value * cents * 100) / 100,
    index,
  }));
  const rest = lines.pop();
  lines.sort((a, b) => b.back - a.back || a.index - b.index);
  return [...lines, rest].map(({ index, ...line }) => line);
}

/**
 * What the wallet costs a year: { now, next, changes: [{ card, fee, from, diff }] }.
 * `next` is the total once every upcoming fee change has happened.
 */
export function walletFees(cards, today) {
  let now = 0;
  let next = 0;
  const changes = [];
  for (const card of cards || []) {
    const { fee, change } = feeInfo(card, today);
    now += fee;
    if (change?.upcoming) {
      next += change.fee;
      changes.push({ card, fee: change.fee, from: change.from, diff: change.diff });
    } else next += fee;
  }
  changes.sort((a, b) => a.from.localeCompare(b.from));
  const r = (n) => Math.round(n * 100) / 100;
  return { now: r(now), next: r(next), changes };
}

const PERK_LABELS = { travel: "Travel", insurance: "Insurance", everyday: "Everyday" };

/**
 * A card's perks grouped for display: [{ kind, label, items: [text] }], in
 * PERK_KINDS order, empty groups left out.
 */
export function perkGroups(card) {
  return PERK_KINDS
    .map((kind) => ({
      kind,
      label: PERK_LABELS[kind],
      items: (card?.perks || []).filter((p) => p?.kind === kind).map((p) => p.text),
    }))
    .filter((group) => group.items.length);
}
