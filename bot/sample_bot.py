#!/usr/bin/env python3
"""Ten Bids sample agent. Python 3 standard library only.

  python sample_bot.py                     # create a 2-seat match vs a house bot and play it
  python sample_bot.py --seats 4           # 4 seats, empty ones filled with house bots
  python sample_bot.py --join ABCDE        # take a seat in a match a human created
  python sample_bot.py --base http://localhost:8787   # point at a local `wrangler dev`

Strategy: bid big for big pots, dump low cards on small pots, stay just above the bottom on
negative pots, and avoid cards an opponent is likely to tie with.
"""
import argparse, json, time, urllib.request, urllib.error

BASE = "https://ten-bids.antheducation.workers.dev"


class Conflict(Exception):
    pass


def call(path, body=None, retries=2):
    req = urllib.request.Request(BASE + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", "user-agent": "ten-bids-sample-bot"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        try:
            msg = json.loads(msg).get("error", msg)
        except ValueError:
            pass
        if e.code == 409:
            raise Conflict(msg)           # e.g. the turn clock already played for us
        raise SystemExit(f"{e.code}: {msg}")
    except urllib.error.URLError:
        if retries <= 0:
            raise
        time.sleep(1)
        return call(path, body, retries - 1)


def choose(state):
    hand = sorted(state["legalMoves"])
    if len(hand) == 1:
        return hand[0]
    value = state["potValue"]
    # Cards opponents still hold: avoid bids lots of them could tie with.
    others = [p["hand"] for p in state["players"] if not p["you"]]
    def tie_risk(c):
        return sum(c in h for h in others)
    if value <= 0 and state["rule"] == "high":
        return hand[0]                                   # worthless pot: shed the weakest card
    if state["rule"] == "low":
        pool = hand[1:len(hand) // 2 + 1] or hand       # not the very bottom, not wasting top cards
    else:
        upcoming = state["prizesLeft"]
        bigger = sum(1 for p in upcoming if p > value)
        share = 1 - bigger / max(1, len(upcoming))       # how good this pot is vs what is still coming
        lo = int(share * (len(hand) - 1) * 0.6)
        pool = hand[lo:] if share > 0.5 else hand[lo:lo + 3]
    return min(pool, key=lambda c: (tie_risk(c), -c if state["rule"] == "high" else c))


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--join", help="match code to join")
    ap.add_argument("--seats", type=int, default=2)
    ap.add_argument("--name", default="SampleBot")
    a = ap.parse_args()
    BASE = a.base.rstrip("/")

    code = a.join or call("/api/matches", {"seats": a.seats})["code"]
    me = call(f"/api/matches/{code}/join", {"name": a.name, "kind": "agent"})
    token = me["token"]
    print(f"match {code}, seat {me['seat']}  watch: {BASE}/?replay={code}")
    if not a.join:
        call(f"/api/matches/{code}/bots", {"token": token})

    while True:
        s = call(f"/api/matches/{code}/state?token={token}")
        if s["status"] == "finished":
            for p in s["players"]:
                print(f"  {p['name']:<14} {p['score']:>3}")
            print("winner(s):", ", ".join(s["players"][w]["name"] for w in s["winners"]))
            return
        if s["status"] == "expired":
            raise SystemExit("lobby expired")
        if s.get("yourTurn"):
            bid = choose(s)
            print(f"round {s['round']}: pot {s['pot']} ({s['rule']}) -> bid {bid}")
            try:
                call(f"/api/matches/{code}/move", {"token": token, "bid": bid})
            except Conflict as c:
                print("  (skipped:", c, ")")
                continue
        time.sleep(1)


if __name__ == "__main__":
    main()
