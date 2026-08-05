// Milliunit helpers. YNAB stores every amount as an integer number of
// milliunits (1/1000 of a currency unit): $12.34 is 12340.

export function toMilliunits(amount) {
  if (amount === null || amount === undefined || amount === "") return 0;
  return Math.round(Number(amount) * 1000);
}

export function fromMilliunits(milliunits) {
  return (Number(milliunits || 0) / 1000);
}

export function fmt(milliunits, symbol = "$") {
  const value = fromMilliunits(milliunits);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${abs}`;
}

// Split a total between two people without losing a milliunit to rounding:
// the second share absorbs the remainder. Matches the original script's
// arithmetic, including for negative totals (outflows).
export function splitMilliunits(total, ratioFirst) {
  const whole = Math.trunc(total);
  const first = Math.round(whole * Number(ratioFirst));
  return [first, whole - first];
}
