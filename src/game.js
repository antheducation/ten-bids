// Pure game rules for Ten Bids. No I/O here, so the rules are easy to test.

export const HAND = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const PRIZES = [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7];
export const ROUNDS = PRIZES.length;

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const potValue = (pot) => pot.reduce((s, c) => s + c, 0);
// A pot worth zero or more goes to the highest unique bid; a negative pot to the lowest.
export const potRule = (pot) => (potValue(pot) >= 0 ? "high" : "low");

// bids: { [seat]: card }. Returns { winner: seat|null, cancelled: [cards] }.
export function resolveBids(bids, pot) {
  const counts = {};
  for (const c of Object.values(bids)) counts[c] = (counts[c] || 0) + 1;
  const cancelled = Object.keys(counts).filter((c) => counts[c] > 1).map(Number).sort((a, b) => a - b);
  const unique = Object.entries(bids).filter(([, c]) => counts[c] === 1);
  if (unique.length === 0) return { winner: null, cancelled };
  const high = potRule(pot) === "high";
  unique.sort((a, b) => (high ? b[1] - a[1] : a[1] - b[1]));
  return { winner: Number(unique[0][0]), cancelled };
}

// A reasonable but beatable house bot: scales its bid with the pot, with noise.
export function botBid(hand, pot, rand = Math.random) {
  const h = hand.slice().sort((a, b) => a - b);
  if (h.length === 1) return h[0];
  const v = potValue(pot);
  let frac;
  if (v > 0) frac = Math.min(1, v / 8);           // big pot -> big card
  else if (v < 0) frac = 0.15 + rand() * 0.35;     // dodge the bottom
  else frac = 0;                                    // worthless pot -> dump low card
  let idx = Math.round(frac * (h.length - 1) + (rand() * 2 - 1) * 1.5);
  idx = Math.max(0, Math.min(h.length - 1, idx));
  return h[idx];
}
