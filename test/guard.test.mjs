// The guard is tested against the real Guard class with an in-memory storage stub,
// so "it blocks" is proven by a block happening, not by reading the code.
import test from "node:test";
import assert from "node:assert/strict";
import { Guard, isPlatformIp, callerKey, checkCaller, LIMITS } from "../src/guard.js";
import worker from "../src/index.js";

function fakeCtx() { const m = new Map(); return { storage: { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, deleteAll: async () => m.clear() } }; }
// A fake GUARD namespace: one Guard per name, like the real thing.
// The runtime turns stub.fetch(url) into a Request for the object's fetch(); mirror that.
function fakeNs() { const objs = new Map(); return { idFromName: (n) => n, get: (id) => { if (!objs.has(id)) objs.set(id, new Guard(fakeCtx())); const g = objs.get(id); return { fetch: (u) => g.fetch(new Request(u)) }; } }; }

test("platform IPs: Anthropic + OpenAI recognised, ordinary IPs not", () => {
  assert.equal(isPlatformIp("160.79.104.10"), true);
  assert.equal(isPlatformIp("160.79.111.255"), true);
  assert.equal(isPlatformIp("153.61.210.4"), true);
  assert.equal(isPlatformIp("160.79.112.1"), false);
  assert.equal(isPlatformIp("1.2.3.4"), false);
  assert.equal(isPlatformIp("49.180.12.7"), false);
  assert.equal(isPlatformIp("garbage"), false);
});

test("caller key: direct = IP, platform = session or platform-IP", () => {
  assert.deepEqual(callerKey("1.2.3.4", "abc"), { key: "ip:1.2.3.4", kind: "direct" });
  assert.deepEqual(callerKey("160.79.104.10", "abc-123"), { key: "s:abc-123", kind: "session" });
  assert.deepEqual(callerKey("160.79.104.10", ""), { key: "p:160.79.104.10", kind: "platformIp" });
});

test("direct IP: normal use passes, a flood gets blocked and escalates", async () => {
  const g = new Guard(fakeCtx());
  for (let i = 0; i < LIMITS.direct.burst10s; i++) assert.equal((await g.hit("direct")).ok, true, `call ${i}`);
  const tripped = await g.hit("direct");
  assert.equal(tripped.ok, false);
  assert.equal(tripped.reason, "burst");
  const hour = tripped.until - Date.now();
  assert.ok(hour > 59 * 60e3 && hour <= 60 * 60e3, `first block ~1h, got ${hour}`);
  assert.equal((await g.hit("direct")).ok, false, "still blocked");
  // force the block to expire, flood again: second strike is 24h
  g.block.until = Date.now() - 1;
  let r; for (let i = 0; i <= LIMITS.direct.burst10s; i++) r = await g.hit("direct");
  assert.equal(r.ok, false);
  assert.ok(r.until - Date.now() > 23 * 3600e3, "second block ~24h");
});

test("block survives a Durable Object restart (it is in storage)", async () => {
  const ctx = fakeCtx();
  const g = new Guard(ctx);
  for (let i = 0; i <= LIMITS.direct.burst10s; i++) await g.hit("direct");
  const fresh = new Guard(ctx);
  assert.equal((await fresh.hit("direct")).ok, false);
});

test("shared platform IP is never long-blocked", async () => {
  const g = new Guard(fakeCtx());
  let r; for (let i = 0; i <= LIMITS.platformIp.burst10s; i++) r = await g.hit("platformIp");
  assert.equal(r.ok, false);
  assert.ok(r.until - Date.now() <= 60e3, "platform IP block is a minute at most");
});

test("checkCaller: one abuser on Claude.ai does not block another Claude.ai user", async () => {
  const env = { GUARD: fakeNs() };
  for (let i = 0; i <= LIMITS.session.burst10s; i++) await checkCaller(env, "160.79.104.10", "abuser");
  assert.equal((await checkCaller(env, "160.79.104.10", "abuser")).ok, false);
  assert.equal((await checkCaller(env, "160.79.104.10", "someone-else")).ok, true);
});

test("checkCaller: manual blocklist + guard outage fails open", async () => {
  assert.equal((await checkCaller({ BLOCKLIST: "9.9.9.9", GUARD: fakeNs() }, "9.9.9.9", "")).ok, false);
  assert.equal((await checkCaller({ BLOCKLIST: "160.79.104.10" }, "160.79.104.10", "")).ok, true, "never manually ban a platform IP");
  const broken = { GUARD: { idFromName: () => 1, get: () => ({ fetch: async () => { throw new Error("down"); } }) } };
  assert.equal((await checkCaller(broken, "5.5.5.5", "")).ok, true);
});

test("end to end through the worker: flood from one IP gets 429, another IP is fine", async () => {
  const env = { GUARD: fakeNs() };
  const call = (ip) => worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }), env);
  let last; for (let i = 0; i <= LIMITS.direct.burst10s; i++) last = await call("7.7.7.7");
  assert.equal(last.status, 429);
  assert.match((await last.json()).error.message, /Blocked/);
  assert.ok(Number(last.headers.get("retry-after")) > 3000);
  assert.equal((await call("8.8.4.4")).status, 200);
  // initialize hands out a session id
  const init = await worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "6.6.6.6" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }), env);
  assert.match(init.headers.get("mcp-session-id") || "", /^[0-9a-f-]{36}$/);
});

test("admin unblock lets the caller straight back in", async () => {
  const { forgetCached } = await import("../src/guard.js");
  const env = { GUARD: fakeNs() };
  for (let i = 0; i <= LIMITS.direct.burst10s; i++) await checkCaller(env, "4.4.4.4", "");
  assert.equal((await checkCaller(env, "4.4.4.4", "")).ok, false);
  await env.GUARD.get("ip:4.4.4.4").fetch("https://guard/unblock");
  forgetCached("ip:4.4.4.4");
  assert.equal((await checkCaller(env, "4.4.4.4", "")).ok, true);
});
