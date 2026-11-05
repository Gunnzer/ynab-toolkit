// The Canadian credit cards Card Rewards knows about, and how each earns.
//
// The cards themselves are data, not code: web/data/cards.json, downloaded
// by the app at most once a day (card_feed.js), like an exchange rate feed.
// A scheduled Claude Code task re-checks every card once a month and
// commits the file to the `card-data` branch only; the daily Pages deploy
// copies it in from there, after the tests have validated it. Nothing
// about it is ever pushed to main by that task. See CLAUDE.md, "Card
// Rewards".
//
// What is fixed here in code is what the logic depends on: the purchase
// types and the card networks. Point types live in the data file, so a new
// card can bring a new kind of points without a code change.
//
// The data file: { checked, pointTypes, cards }
//   checked: "YYYY-MM-DD", the newest card's `checked`
//   pointTypes: { id: { name, unit: "points" | "percent", cents?, note? } }
//     cents: what one point is worth in CAD cents, at the LOW END of
//     published valuations for a normal redemption (at explicit user
//     request): Aeroplan, and Membership Rewards moved to it 1:1, at an
//     economy-flight value (1.1); Scene+ and Avion at their fixed travel
//     rate; PC Optimum at the till. Not gift cards or merchandise, which
//     are worth less still. People can change it on the page; cash back is
//     always 1 cent per percent.
//     transfers: { otherPointTypeId: ratio } - what one point becomes when
//     moved to another program in the list (Membership Rewards to Aeroplan
//     is 1). Used when someone picks preferred points on the page.
//   cards: [card]
//
// A card:
//   id, name, issuer, network ("amex" | "visa" | "mastercard"),
//   points (a pointTypes id), annualFee and fxFee (CAD, fraction),
//   base: what every purchase earns when no rule matches,
//   earn: rules, checked in order, the first that matches wins:
//     on: purchase ids (PURCHASES), "*" for every purchase, or "picks" for
//         the categories the cardholder chose (see `picks` below)
//     rate: points per $1, or percent for cash back
//     when: answers that must hold, e.g. { store: ["loblaw"] }. A key that
//         is not asked for this purchase never holds. `flag` is a yes/no the
//         cardholder sets once on the card (see `flags`).
//     cap: { key, spend, per: "month" | "year", label } - past it the rule
//         stops matching. Rules sharing a key share the cap.
//   picks: { count, from, label } - categories the cardholder chooses
//   flags: [{ id, label }] - yes/no facts about the cardholder
//   notes: things the rules cannot say
//   source, checked: where the figures came from (named, never linked - the
//     privacy test allows no third party host) and when (YYYY-MM-DD)

export const PURCHASES = [
  { id: "groceries", label: "Groceries" },
  { id: "dining", label: "Restaurants, bars and coffee" },
  { id: "delivery", label: "Food delivery (Uber Eats, DoorDash, Skip)" },
  { id: "gas", label: "Gas" },
  { id: "ev", label: "EV charging" },
  { id: "transit", label: "Transit, taxis and rideshare" },
  { id: "streaming", label: "Streaming (Netflix, Spotify, Crave)" },
  { id: "bills", label: "Recurring bills (phone, internet, insurance)" },
  { id: "drugstore", label: "Drugstore" },
  { id: "entertainment", label: "Movies, concerts and events" },
  { id: "travel", label: "Flights, hotels and travel" },
  { id: "other", label: "Everything else" },
];

export const NETWORKS = {
  amex: "American Express",
  visa: "Visa",
  mastercard: "Mastercard",
};

// The loaded catalogue. These are live bindings: every module importing
// them sees the new values after setCatalogue(). Empty until the data file
// has been loaded once.
export let CATALOGUE_CHECKED = "";
export let POINT_TYPES = {};
export let CARDS = [];

/** Swap in a catalogue. Validate it first (validateCatalogue). */
export function setCatalogue(data) {
  CATALOGUE_CHECKED = data?.checked || "";
  POINT_TYPES = data?.pointTypes || {};
  CARDS = Array.isArray(data?.cards) ? data.cards : [];
}
