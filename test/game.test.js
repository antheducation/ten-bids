import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBids, potRule, botBid, HAND } from "../src/game.js";

test("highest unique bid takes a positive pot", () => {
  assert.deepEqual(resolveBids({ 0: 9, 1: 9, 2: 4 }, [5]), { winner: 2, cancelled: [9] });
});
test("lowest unique bid is stuck with a negative pot", () => {
  assert.deepEqual(resolveBids({ 0: 1, 1: 1, 2: 3, 3: 8 }, [-2]), { winner: 2, cancelled: [1] });
});
test("all bids tied: nobody wins, pot carries", () => {
  assert.equal(resolveBids({ 0: 6, 1: 6 }, [4]).winner, null);
});
test("carried pot rule follows its sum", () => {
  assert.equal(potRule([-3, 2]), "low");
  assert.equal(potRule([-1, 1]), "high");
});
test("house bot always bids a card it holds", () => {
  for (let i = 0; i < 500; i++) {
    const hand = HAND.filter(() => Math.random() > 0.4);
    if (!hand.length) continue;
    assert.ok(hand.includes(botBid(hand, [Math.floor(Math.random() * 11) - 3])));
  }
});
