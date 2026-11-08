// The Tier list: a published ranking of Canadian cards (in the card details
// file, reviewed by the twice-weekly check), which anyone can rearrange on
// their own device (at explicit user request). Moves are kept as
// overrides on top of the published list, so a later published change
// still shows for every card that was not moved.

/** The tier id a card has in the published list, or "" when unranked. */
export function publishedTier(published, cardId) {
  for (const tier of published?.tiers || []) {
    if (tier.cards.some((entry) => entry.card === cardId)) return tier.id;
  }
  return "";
}

/**
 * The tiers as shown: the published list with the person's moves applied.
 *   { tiers: [{ id, label, cards: [{ card, why, moved }] }], unranked: [card] }
 * `overrides` maps a card id to a tier id, or "" to take it off the list.
 * Cards are the catalogue's; a published entry for a card no longer in it
 * is dropped. Moved cards go to the end of their new tier.
 */
export function tierBoard(published, overrides = {}, cards = []) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const why = new Map();
  const tiers = (published?.tiers || []).map((tier) => ({ id: tier.id, label: tier.label, cards: [] }));
  const tierOf = new Map(tiers.map((t) => [t.id, t]));
  for (const tier of published?.tiers || []) {
    for (const entry of tier.cards) {
      why.set(entry.card, entry.why);
      if (!byId.has(entry.card)) continue;
      const target = Object.hasOwn(overrides, entry.card) ? overrides[entry.card] : tier.id;
      if (target === tier.id) tierOf.get(tier.id).cards.push({ card: byId.get(entry.card), why: entry.why, moved: false });
    }
  }
  const placed = new Set(tiers.flatMap((t) => t.cards.map((e) => e.card.id)));
  for (const [cardId, target] of Object.entries(overrides)) {
    if (placed.has(cardId) || !byId.has(cardId) || !tierOf.has(target)) continue;
    tierOf.get(target).cards.push({ card: byId.get(cardId), why: why.get(cardId) || "", moved: true });
    placed.add(cardId);
  }
  const unranked = cards.filter((c) => !placed.has(c.id));
  return { tiers, unranked };
}

/**
 * The overrides after moving one card to `tierId` ("" = off the list). A
 * move back to where the published list has it removes the override, so
 * the card follows the published list again.
 */
export function moveCard(overrides, published, cardId, tierId) {
  const next = { ...overrides };
  if (publishedTier(published, cardId) === tierId) delete next[cardId];
  else next[cardId] = tierId;
  return next;
}
