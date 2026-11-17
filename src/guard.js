// Abuse guard. One Durable Object instance per caller key holds that caller's counters and,
// once it trips a limit, its block. Blocks escalate: 1 hour, then 24 hours, then 7 days.
//
// Caller key:
//   - Direct clients (Claude Code, Cursor, scripts): their IP. Blocking it blocks them.
//   - Hosted platforms (Claude.ai, ChatGPT): requests come from shared Anthropic/OpenAI
//     egress IPs, so one IP is thousands of users. Those IPs are NEVER banned. The key is
//     the MCP session id we hand out at initialize; with no session, a high per-IP ceiling
//     that only ever blocks for a minute.
import { PLATFORM_V4, PLATFORM_V6 } from "./platform-ips.js";

export const LIMITS = {
  direct: { burst10s: 20, perMin: 60, perDay: 1500 },
  session: { burst10s: 20, perMin: 60, perDay: 1500 },
  platformIp: { burst10s: 400, perMin: 1500, perDay: 200000 },
};
export const BLOCK_STEPS_MS = [60 * 60e3, 24 * 60 * 60e3, 7 * 24 * 60 * 60e3];
const PLATFORM_IP_BLOCK_MS = 60e3;

// ---------- CIDR matching
function v4ToInt(ip) { const p = ip.split(".").map(Number); return p.length === 4 && p.every((n) => n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
const V4 = PLATFORM_V4.map((c) => { const [ip, bits] = c.split("/"); const b = Number(bits); return { base: v4ToInt(ip), mask: b === 0 ? 0 : (~0 << (32 - b)) >>> 0 }; });
function v6ToBig(ip) {
  let [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail !== undefined && tail ? tail.split(":") : [];
  const parts = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (parts.length !== 8) return null;
  return parts.reduce((acc, x) => (acc << 16n) + BigInt(parseInt(x || "0", 16)), 0n);
}
const V6 = PLATFORM_V6.map((c) => { const [ip, bits] = c.split("/"); const b = BigInt(bits); return { base: v6ToBig(ip), bits: b }; });
export function isPlatformIp(ip = "") {
  if (ip.includes(":")) {
    const n = v6ToBig(ip); if (n === null) return false;
    return V6.some(({ base, bits }) => base !== null && (n >> (128n - bits)) === (base >> (128n - bits)));
  }
  const n = v4ToInt(ip); if (n === null) return false;
  return V4.some(({ base, mask }) => ((n & mask) >>> 0) === ((base & mask) >>> 0));
}

export function callerKey(ip, sessionId) {
  if (isPlatformIp(ip)) {
    const s = String(sessionId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
    return s ? { key: `s:${s}`, kind: "session" } : { key: `p:${ip}`, kind: "platformIp" };
  }
  return { key: `ip:${ip}`, kind: "direct" };
}

// Isolate-level cache so a blocked caller is turned away without touching the DO.
const blockedCache = new Map();

export async function checkCaller(env, ip, sessionId, cost = 1) {
  const { key, kind } = callerKey(ip, sessionId);
  const manual = String(env.BLOCKLIST || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (manual.includes(ip) && !isPlatformIp(ip)) return { ok: false, until: Infinity, reason: "manual", key };
  // Cached at most 60s, so an admin unblock reaches every isolate within a minute.
  const cached = blockedCache.get(key);
  if (cached && cached.checkAgain > Date.now()) return { ok: false, until: cached.until, reason: "cached", key };
  if (!env.GUARD) return { ok: true, key };
  try {
    const stub = env.GUARD.get(env.GUARD.idFromName(key));
    const res = await stub.fetch(`https://guard/hit?kind=${kind}&cost=${cost}`);
    const r = await res.json();
    if (!r.ok) blockedCache.set(key, { until: r.until, checkAgain: Math.min(r.until, Date.now() + 60e3) });
    else blockedCache.delete(key);
    return { ...r, key };
  } catch {
    return { ok: true, key }; // guard outage must not take the tools down
  }
}

export function forgetCached(key) { blockedCache.delete(key); }

export class Guard {
  constructor(ctx) {
    this.ctx = ctx;
    this.hits = []; // [timestamp, cost] within the last minute
    this.day = { start: 0, count: 0 };
    this.loaded = false;
  }
  async load() {
    if (this.loaded) return;
    this.block = (await this.ctx.storage.get("block")) || null;
    this.strikes = (await this.ctx.storage.get("strikes")) || 0;
    this.day = (await this.ctx.storage.get("day")) || { start: 0, count: 0 };
    this.loaded = true;
  }
  async hit(kind, cost = 1) {
    await this.load();
    const now = Date.now();
    if (this.block && this.block.until > now) return { ok: false, until: this.block.until, reason: this.block.reason };
    const lim = LIMITS[kind] || LIMITS.direct;
    this.hits = this.hits.filter(([t]) => now - t < 60e3);
    this.hits.push([now, cost]);
    if (now - this.day.start > 864e5) this.day = { start: now, count: 0 };
    this.day.count += cost;
    const sum = (ms) => this.hits.reduce((a, [t, c]) => a + (now - t < ms ? c : 0), 0);
    let reason = null;
    if (sum(10e3) > lim.burst10s) reason = "burst";
    else if (sum(60e3) > lim.perMin) reason = "per_minute";
    else if (this.day.count > lim.perDay) reason = "per_day";
    // persist the daily count now and then, not on every hit (storage writes are the costly part)
    if (this.day.count % 25 === 0) await this.ctx.storage.put("day", this.day);
    if (!reason) return { ok: true };
    let ms;
    if (kind === "platformIp") ms = PLATFORM_IP_BLOCK_MS;
    else { ms = BLOCK_STEPS_MS[Math.min(this.strikes, BLOCK_STEPS_MS.length - 1)]; this.strikes += 1; await this.ctx.storage.put("strikes", this.strikes); }
    this.block = { until: now + ms, reason, at: now };
    this.hits = [];
    await this.ctx.storage.put("block", this.block);
    await this.ctx.storage.put("day", this.day);
    return { ok: false, until: this.block.until, reason, firstTrip: true, strikes: this.strikes };
  }
  async fetch(request) {
    const u = new URL(request.url);
    const out = u.pathname === "/hit" ? await this.hit(u.searchParams.get("kind"), Number(u.searchParams.get("cost")) || 1)
      : u.pathname === "/unblock" ? await this.unblock() : await this.status();
    return new Response(JSON.stringify(out, (k, v) => (v === Infinity ? null : v)), { headers: { "content-type": "application/json" } });
  }
  async status() { await this.load(); return { block: this.block, strikes: this.strikes, day: this.day }; }
  async unblock() { await this.ctx.storage.deleteAll(); this.block = null; this.strikes = 0; this.hits = []; this.day = { start: 0, count: 0 }; return { ok: true }; }
}
