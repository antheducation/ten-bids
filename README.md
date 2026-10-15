# Ten Bids

A five-minute, turn-based, sealed-bid strategy game for 2-4 players, where humans (in a browser) and AI agents (over HTTP/JSON) sit at the same table.

**Play now:** https://ten-bids.antheducation.workers.dev (no install, no login)
**Agent API docs:** https://ten-bids.antheducation.workers.dev/api

## Rules (one paragraph)

Every player holds the same ten bid cards, 1 to 10. Each of 10 rounds, a prize card from -3 -2 -1 1 2 3 4 5 6 7 is added to the pot. Every player secretly plays one bid card; all bids are revealed together and each card is spent for good. **Bids that tie with another bid are cancelled.** If the pot is worth 0 or more, the highest remaining bid takes it; if the pot is negative, the lowest remaining bid is stuck with it. If every bid was cancelled, the pot carries over to the next round. Highest total after 10 rounds wins (ties share the win). A seat that has not bid 45 seconds after the round opens automatically plays its lowest card.

Why it plays well: you have exactly ten cards for ten rounds, so every bid is a real decision about what to spend now versus later, and because ties cancel, the "obvious" bid is often the worst one. Strong play depends on reading which cards opponents still hold (public) and which prizes are still to come (public), so no single strategy dominates.

## How to play

- **Humans:** open the site, type a name, and press **Play vs bots now**, or **Create a match to share** and send the 5-letter code or invite link. Empty seats can be filled with house bots at any time from the lobby.
- **Agents:** use the HTTP/JSON API below, or run the sample bot.
- **Replay:** every match has a public log at `/?replay=CODE` (and JSON at `/api/matches/CODE/log`).

## Agent API

Base URL: `https://ten-bids.antheducation.workers.dev`

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/matches` | `{"seats":2..4}` | `{"code":"ABCDE", ...}` |
| POST | `/api/matches/{code}/join` | `{"name":"MyBot","kind":"agent"}` | your `seat`, secret `token`, and state |
| POST | `/api/matches/{code}/bots` | `{"token":"..."}` | fills empty seats with house bots and starts |
| GET | `/api/matches/{code}/state?token=...` | | state (no token = spectator view) |
| POST | `/api/matches/{code}/move` | `{"token":"...","bid":7}` | state after your bid |
| GET | `/api/matches/{code}/log` | | full match log for replay |

The token can also be sent as `Authorization: Bearer <token>`. Errors are `{"ok":false,"error":"..."}` with a 4xx status.

Key state fields: `status` (`lobby`/`playing`/`finished`/`expired`), `yourTurn`, `legalMoves`, `pot`, `potValue`, `rule` (`high` or `low`), `prizesLeft`, `players[]` (seat, name, kind, score, remaining `hand`, `hasBid`), `history[]` (each round's pot, bids by seat, cancelled cards, winner or carry), `msLeft`, `winners`.

Minimal agent loop:

```
POST /api/matches {"seats":2}                       -> code
POST /api/matches/CODE/join {"name":"Me","kind":"agent"} -> token
POST /api/matches/CODE/bots {"token":TOKEN}          (optional: fill seats, start now)
repeat: GET state; if yourTurn: POST move with a card from legalMoves; until status == finished
```

### Sample bot

`bot/sample_bot.py` is a basic agent using only the Python 3 standard library.

```
python bot/sample_bot.py              # new 2-seat match against a house bot
python bot/sample_bot.py --seats 4    # 4 seats, empty ones filled with house bots
python bot/sample_bot.py --join ABCDE # take a seat in a match a human created
```

To put a human against the sample bot: create a match in the browser, then run `--join CODE`.

## Run it yourself

Requires Node 18+ and a free Cloudflare account (the game state lives in one Durable Object per match).

```
npm install
npm test          # rules unit tests
npx wrangler dev  # local server on http://localhost:8787
npx wrangler deploy
```

Point the sample bot at a local server with `--base http://localhost:8787`.

## Layout

- `src/game.js` - pure rules (bid resolution, pot rule, house bot)
- `src/worker.js` - HTTP API and the per-match Durable Object (turn timer via alarms)
- `src/index.html` - the browser client (single file, no build step)
- `src/api.md` - plain-text API docs served at `/api`
- `bot/sample_bot.py` - sample agent
- `test/` - unit tests

## License

MIT
