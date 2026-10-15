import { DurableObject } from "cloudflare:workers";
import { HAND, PRIZES, ROUNDS, shuffle, potValue, potRule, resolveBids, botBid } from "./game.js";
import INDEX_HTML from "./index.html";
import API_MD from "./api.md";

const TURN_MS = 45_000;        // a seat that has not bid by then plays its lowest card
const LOBBY_MS = 30 * 60_000;  // unfilled lobbies expire
const BOT_NAMES = ["Bot Ada", "Bot Turing", "Bot Hopper", "Bot Lovelace"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" },
  });
const err = (status, message) => json({ ok: false, error: message }, status);
const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
const cleanName = (n, fallback) => (String(n ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) || fallback);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS")
      return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" } });
    if (p === "/" || p === "/index.html") return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (p === "/api" || p === "/api/" || p === "/docs")
      return new Response(API_MD, { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (p === "/health") return json({ ok: true });

    if (p === "/api/matches" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const seats = Math.max(2, Math.min(4, Number(body.seats) || 2));
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.MATCH.get(env.MATCH.idFromName(code));
        const r = await stub.create(code, seats);
        if (r.ok) return json({ ok: true, code, seats, join: `/api/matches/${code}/join`, url: `${url.origin}/?m=${code}` }, 201);
      }
      return err(503, "could not allocate a match code, try again");
    }

    const m = p.match(/^\/api\/matches\/([A-Za-z]{5})(?:\/(join|state|move|bots|log))?\/?$/);
    if (!m) return err(404, "not found; see GET /api for the API");
    const code = m[1].toUpperCase();
    const action = m[2] || "state";
    const stub = env.MATCH.get(env.MATCH.idFromName(code));
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let body = {};
    if (request.method === "POST") body = await request.json().catch(() => ({}));
    const tok = body.token || auth || url.searchParams.get("token") || "";

    let r;
    if (action === "join" && request.method === "POST") r = await stub.join(body.name, body.kind);
    else if (action === "bots" && request.method === "POST") r = await stub.fillBots(tok);
    else if (action === "move" && request.method === "POST") r = await stub.move(tok, Number(body.bid));
    else if (action === "state" && request.method === "GET") r = await stub.view(tok);
    else if (action === "log" && request.method === "GET") r = await stub.log();
    else return err(405, "method not allowed");
    const { http, ...out } = r;
    return json(out, http || (r.ok ? 200 : 400));
  },
};

export class Match extends DurableObject {
  async load() {
    if (this.m === undefined) this.m = (await this.ctx.storage.get("m")) || null;
    return this.m;
  }
  async save() {
    await this.ctx.storage.put("m", this.m);
  }

  async create(code, seats) {
    if (await this.load()) return { ok: false };
    this.m = {
      code, seats, status: "lobby", createdAt: Date.now(),
      players: [], prizes: shuffle(PRIZES), round: 0, pot: [], bids: {}, deadline: null,
      history: [], winners: null,
    };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + LOBBY_MS);
    return { ok: true };
  }

  async join(name, kind) {
    const m = await this.load();
    if (!m) return { ok: false, http: 404, error: "no such match" };
    if (m.status !== "lobby") return { ok: false, http: 409, error: "match already started" };
    const seat = m.players.length;
    const t = token();
    m.players.push({ seat, name: cleanName(name, `Player ${seat + 1}`), kind: kind === "agent" ? "agent" : "human", token: t, hand: HAND.slice(), score: 0, won: [] });
    if (m.players.length === m.seats) this.start();
    await this.save();
    return { ok: true, seat, token: t, host: seat === 0, ...this.publicView(seat) };
  }

  async fillBots(tok) {
    const m = await this.load();
    if (!m) return { ok: false, http: 404, error: "no such match" };
    const me = m.players.find((p) => p.token === tok);
    if (!me) return { ok: false, http: 403, error: "only a seated player can add bots" };
    if (m.status !== "lobby") return { ok: false, http: 409, error: "match already started" };
    while (m.players.length < m.seats) {
      const seat = m.players.length;
      m.players.push({ seat, name: BOT_NAMES[seat % BOT_NAMES.length], kind: "bot", token: null, hand: HAND.slice(), score: 0, won: [] });
    }
    this.start();
    await this.save();
    return { ok: true, ...this.publicView(me.seat) };
  }

  start() {
    const m = this.m;
    m.status = "playing";
    m.startedAt = Date.now();
    this.openRound();
  }

  openRound() {
    const m = this.m;
    m.pot.push(m.prizes[m.round]);
    m.bids = {};
    for (const p of m.players) if (p.kind === "bot") m.bids[p.seat] = botBid(p.hand, m.pot);
    m.deadline = Date.now() + TURN_MS;
    this.ctx.storage.setAlarm(m.deadline);
  }

  // Resolve the round once every seat has bid (or the clock forced it).
  advance() {
    const m = this.m;
    if (m.status !== "playing" || Object.keys(m.bids).length < m.players.length) return;
    const pot = m.pot.slice();
    const { winner, cancelled } = resolveBids(m.bids, pot);
    for (const p of m.players) p.hand = p.hand.filter((c) => c !== m.bids[p.seat]);
    const entry = { round: m.round + 1, pot, potValue: potValue(pot), rule: potRule(pot), bids: { ...m.bids }, cancelled, winner, forced: m.forced || [] };
    m.forced = [];
    if (winner !== null) {
      m.players[winner].score += potValue(pot);
      m.players[winner].won.push(...pot);
      m.pot = [];
    } else entry.carried = true;
    m.history.push(entry);
    m.round += 1;
    if (m.round >= ROUNDS) return this.finish();
    this.openRound();
  }

  finish() {
    const m = this.m;
    m.status = "finished";
    m.finishedAt = Date.now();
    m.deadline = null;
    m.discarded = m.pot;
    m.pot = [];
    const best = Math.max(...m.players.map((p) => p.score));
    m.winners = m.players.filter((p) => p.score === best).map((p) => p.seat);
  }

  async move(tok, bid) {
    const m = await this.load();
    if (!m) return { ok: false, http: 404, error: "no such match" };
    const me = m.players.find((p) => p.token && p.token === tok);
    if (!me) return { ok: false, http: 403, error: "bad or missing token" };
    if (m.status !== "playing") return { ok: false, http: 409, error: `match is ${m.status}` };
    if (m.bids[me.seat] !== undefined) return { ok: false, http: 409, error: "you already bid this round" };
    if (!me.hand.includes(bid)) return { ok: false, http: 400, error: `bid must be one of your remaining cards: ${me.hand.join(",")}` };
    m.bids[me.seat] = bid;
    this.advance();
    await this.save();
    return { ok: true, ...this.publicView(me.seat) };
  }

  async alarm() {
    const m = await this.load();
    if (!m) return;
    if (m.status === "lobby" && Date.now() - m.createdAt >= LOBBY_MS) {
      m.status = "expired";
      return this.save();
    }
    if (m.status !== "playing" || !m.deadline) return;
    if (Date.now() < m.deadline) return this.ctx.storage.setAlarm(m.deadline);
    m.forced = [];
    for (const p of m.players)
      if (m.bids[p.seat] === undefined) { m.bids[p.seat] = Math.min(...p.hand); m.forced.push(p.seat); }
    this.advance();
    await this.save();
  }

  async view(tok) {
    const m = await this.load();
    if (!m) return { ok: false, http: 404, error: "no such match" };
    const me = m.players.find((p) => p.token && p.token === tok);
    return { ok: true, ...this.publicView(me ? me.seat : null) };
  }

  async log() {
    const m = await this.load();
    if (!m) return { ok: false, http: 404, error: "no such match" };
    return {
      ok: true, code: m.code, status: m.status, startedAt: m.startedAt ?? null, finishedAt: m.finishedAt ?? null,
      players: m.players.map((p) => ({ seat: p.seat, name: p.name, kind: p.kind, score: p.score })),
      rounds: m.history, winners: m.winners,
    };
  }

  publicView(seat) {
    const m = this.m;
    const me = seat === null ? null : m.players[seat];
    const out = {
      code: m.code, status: m.status, seatsTotal: m.seats, round: Math.min(m.round + 1, ROUNDS), rounds: ROUNDS,
      pot: m.pot, potValue: potValue(m.pot), rule: m.pot.length ? potRule(m.pot) : null,
      deadline: m.deadline, msLeft: m.deadline ? Math.max(0, m.deadline - Date.now()) : null,
      prizesLeft: m.prizes.slice(m.round + (m.status === "playing" ? 1 : 0)).sort((a, b) => a - b),
      players: m.players.map((p) => ({
        seat: p.seat, name: p.name, kind: p.kind, score: p.score, won: p.won, hand: p.hand,
        hasBid: m.bids[p.seat] !== undefined, you: p.seat === seat,
      })),
      history: m.history, winners: m.winners,
    };
    if (me) {
      out.you = { seat: me.seat, hand: me.hand, bid: m.bids[me.seat] ?? null };
      out.yourTurn = m.status === "playing" && m.bids[me.seat] === undefined;
      out.legalMoves = out.yourTurn ? me.hand.slice() : [];
    }
    return out;
  }
}
