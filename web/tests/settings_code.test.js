import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { decodeSettings, encodeSettings } from "../js/tools/settings_code.js";

describe("settings code", () => {
  const payload = {
    app: "YNAB Toolkit", schema: 1,
    settings: { people: { person1: { name: "Alex" } }, reports: { saved: [{ name: "Mine" }] } },
  };

  test("round trips, compressed", async () => {
    const code = await encodeSettings(payload);
    assert.match(code, /^YTK1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeSettings(code), payload);
  });

  test("survives a messaging app wrapping it onto several lines", async () => {
    const code = await encodeSettings(payload);
    const wrapped = code.match(/.{1,20}/g).join("\n  ");
    assert.deepEqual(await decodeSettings(wrapped), payload);
  });

  test("anything else is refused in plain words", async () => {
    await assert.rejects(decodeSettings("hello"), /not a settings code/);
    const code = await encodeSettings(payload);
    await assert.rejects(decodeSettings(code.slice(0, -10)), /part of it is missing/);
  });
});
