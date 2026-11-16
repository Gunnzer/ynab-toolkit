// The Point values window, shared by My cards and Points: what one point of
// each kind is worth to you. Blank means the program's standard value.

import { POINT_TYPES } from "../tools/card_catalogue.js";
import { centsPerPoint, groupName, groupUnit, transferRatio, walletCards } from "../tools/card_rewards.js";
import { customDialog, el, hint, textInput } from "../ui.js";

/** Opens the window; true once new values are saved. */
export async function editPointValues(store) {
  const settings = store.section("cardRewards");
  if (!settings.values || typeof settings.values !== "object") settings.values = {};
  const held = [...new Set(walletCards(settings.wallet).map((c) => c.points))]
    .filter((points) => groupUnit(points) !== "percent");
  const others = Object.keys(POINT_TYPES)
    .filter((points) => !held.includes(points) && groupUnit(points) !== "percent");
  const result = await customDialog("Point values", (body) => {
    body.append(hint("What one point is worth to you, in cents. Leave a box " +
      "blank for the standard value: what a normal redemption gives, such as " +
      "10,000 PC Optimum points for $10 or Aeroplan on an economy flight. " +
      "Put more if you do better (Shoppers bonus events, business-class " +
      "flights) or less if you use gift cards and merchandise. Cash back is " +
      "always worth what it says."));
    const inputs = {};
    const list = el("div", { class: "reward-values" });
    const addRow = (points) => {
      const typical = centsPerPoint(points, {});
      const input = textInput(settings.values[points] ?? "", { type: "number", placeholder: `${typical}` });
      input.min = "0";
      input.step = "0.01";
      input.setAttribute("inputmode", "decimal");
      inputs[points] = input;
      list.append(el("label", { class: "reward-value-row" },
        el("span", { class: "reward-value-name" },
          el("span", { text: groupName(points) }),
          el("span", {
            class: "hint",
            text: settings.preferred && points !== settings.preferred && transferRatio(points, settings.preferred) > 0
              ? `Counted as ${groupName(settings.preferred)} while that is preferred`
              : `Standard value ${typical}¢`,
          })),
        el("span", { class: "reward-value-input" }, input, el("span", { class: "hint", text: "¢" }))));
    };
    held.forEach(addRow);
    if (others.length) {
      list.append(el("div", { class: "field-label reward-values-more", text: "Other kinds of points" }));
      others.forEach(addRow);
    }
    body.append(list);
    return {
      value: () => Object.fromEntries(Object.entries(inputs)
        .filter(([, input]) => input.value !== "" && Number(input.value) >= 0)
        .map(([points, input]) => [points, Number(input.value)])),
    };
  }, { confirmText: "Save" });
  if (!result) return false;
  settings.values = result;
  store.save();
  return true;
}
