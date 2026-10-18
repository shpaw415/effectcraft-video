#!/usr/bin/env bun
/**
 * effectcraft-video — MCP stdio gate for effectcraft-cli.
 *
 * Sits between opencode (MCP client) and `effectcraft-cli mcp` (EffectCraft's
 * MCP server). The daemon registers this gate globally, so the gate — not
 * opencode — enforces the lock:
 *
 *   - Locked (default): tools/list -> [], tools/call -> clear refusal.
 *   - Unlocked: full pass-through to a lazily spawned headless EffectCraft.
 *
 * A session is "open" while ~/.open-bot/plugin-effectcraft-video/session.json
 * holds {"expires": <epochMs>} in the future. Only the plugin CLI
 * (ob-plugin-effectcraft-video-mcp open|close) writes or removes that file.
 *
 * Degradation: if effectcraft-cli is missing, every call gets a clean error
 * (never a crash, never a stack trace).
 */
import { createInterface } from "node:readline";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const HOME = process.env.HOME || "/home/agent";
const STATE_DIR = `${HOME}/.open-bot/plugin-effectcraft-video`;
const SESSION_FILE = `${STATE_DIR}/session.json`;
const LOG_FILE = `${STATE_DIR}/gate.log`;
const CONFIG_FILE = `${HOME}/.config/open-bot/plugin-effectcraft-video.json`;
const LIST_WHILE_LOCKED = true; // ALWAYS advertise the real toolset: clients (opencode) fetch
// tools/list once at daemon boot while we are locked — an empty list would be cached forever.
// The lock is enforced on tools/call, never on tools/list.

function settings(): Record<string, string> {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")).settings || {}; } catch { return {}; }
}
function autosaveEnabled(): boolean { return (settings().autosave ?? "true") !== "false"; }

type JsonRpcId = number | string | null;
interface Msg { jsonrpc: "2.0"; id?: JsonRpcId; method?: string; params?: any; result?: any; error?: any }

function log(line: string) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    try { if (statSync(LOG_FILE).size > 200_000) appendFileSync(LOG_FILE, "--- rotated ---\n"); } catch { /* first write */ }
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch { /* never crash the gate for logging */ }
}

function readSession(): { expires: number } | null {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return typeof s.expires === "number" ? s : null;
  } catch { return null; }
}
function isOpen(): boolean {
  const s = readSession();
  return !!s && s.expires > Date.now();
}

function send(msg: object) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function result(id: JsonRpcId, result: object) { send({ jsonrpc: "2.0", id, result }); }
function errResult(id: JsonRpcId, text: string) {
  send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text }] } });
}
function protoError(id: JsonRpcId, message: string, code = -32601) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const LOCK_MSG =
  "EffectCraft MCP is locked by the effectcraft-video plugin. It unlocks only for the " +
  "Video Creator persona: in a Video Creator thread run `ob-plugin-effectcraft-video-mcp open`, " +
  "do the motion-graphics work, then `ob-plugin-effectcraft-video-mcp close`. " +
  "Check state any time with `ob-plugin-effectcraft-video-mcp status`.";
const EXPIRED_MSG =
  "EffectCraft MCP session expired. In the Video Creator thread run " +
  "`ob-plugin-effectcraft-video-mcp open` again to renew it.";
const MISSING_MSG =
  "effectcraft-cli is not installed. Reinstall the plugin (ob-plugin install effectcraft-video) — " +
  "its setup downloads and installs the EffectCraft deb — then check `ob-plugin-effectcraft-video-mcp status`.";
const BACKEND_MSG =
  "The EffectCraft backend could not be started. Check `ob-plugin-effectcraft-video-mcp status` (gate log) " +
  "and retry; if it persists, run the effectcraft-doctor skill.";

// ---------------------------------------------------------------------------
// Child EffectCraft MCP server (lazy, idle-reaped)
// ---------------------------------------------------------------------------
let child: ReturnType<typeof Bun.spawn> | null = null;
let childReady: Promise<boolean> | null = null;
let reaper: ReturnType<typeof setTimeout> | null = null;
const IDLE_REAP_MS = 15 * 60 * 1000;

const pending = new Map<JsonRpcId, JsonRpcId>(); // child req id -> client req id
const taps = new Map<JsonRpcId, (payload: any) => void>(); // internal probes

function armReaper() {
  if (reaper) clearTimeout(reaper);
  reaper = setTimeout(() => { killChild("idle 15min"); }, IDLE_REAP_MS);
  reaper.unref?.();
}
function killChild(why: string) {
  if (child) { try { child.kill(); } catch { /* already gone */ } }
  child = null; childReady = null; pending.clear(); taps.clear();
  if (why) log(`child stopped (${why})`);
}

function childCliPath(): string | null { return Bun.which("effectcraft-cli"); }

/** Line reader over a web ReadableStream (Bun.spawn pipes) — no node:readline. */
function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const dec = new TextDecoder();
  let buf = "";
  const reader = stream.getReader();
  (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line) onLine(line);
      }
    }
  })().catch((e) => log(`stream reader ended: ${e}`));
}

async function ensureChild(): Promise<boolean> {
  if (child && childReady) return await childReady;
  const cli = childCliPath();
  if (!cli) return false;
  const args = [cli, "mcp"];
  if (autosaveEnabled()) args.push("--autosave");
  try {
    child = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  } catch (e) {
    log(`spawn failed: ${e}`);
    child = null; childReady = null;
    return false;
  }
  log(`child spawned: ${args.join(" ")}`);
  const c = child;
  readLines(c.stdout as ReadableStream<Uint8Array>, (line) => {
    let m: Msg;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && taps.has(m.id as JsonRpcId)) {
      taps.get(m.id as JsonRpcId)!(m.result);
      return;
    }
    if (m.id !== undefined && pending.has(m.id as JsonRpcId)) {
      const clientId = pending.get(m.id as JsonRpcId)!;
      pending.delete(m.id as JsonRpcId);
      send({ jsonrpc: "2.0", id: clientId, ...(m.result !== undefined ? { result: m.result } : { error: m.error }) });
    } else if (m.method && m.id === undefined) {
      send(m as object); // server -> client notification
    }
  });
  readLines(c.stderr as ReadableStream<Uint8Array>, (line) => log(`[ec] ${line}`));
  c.exited.then(() => { if (child === c) killChild("child exit"); });

  childReady = (async () => {
    try {
      c.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: "gate-init", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "effectcraft-gate", version: "0.1.0" } } }) + "\n");
      c.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      await new Promise((r) => setTimeout(r, 500)); // headless handshake is instant
      return c.exitCode === null;
    } catch { return false; }
  })();
  return await childReady;
}

async function forward(clientId: JsonRpcId, method: string, params: any): Promise<boolean> {
  const ok = await ensureChild();
  if (!ok || !child) return false;
  const childId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pending.set(childId, clientId);
  try {
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: childId, method, params }) + "\n");
  } catch (e) {
    pending.delete(childId);
    log(`forward write failed: ${e}`);
    return false;
  }
  armReaper();
  return true;
}

// Tool list cache (disk + memory) so we never spawn EffectCraft just to list tools.
// Keyed on the installed effectcraft-cli version; refetched by a throwaway child.
const TOOLS_CACHE_FILE = `${STATE_DIR}/tools.json`;
let cachedTools: any[] | null = null;

function cliVersion(): string {
  const cli = childCliPath();
  if (!cli) return "";
  try { return Bun.spawnSync([cli, "--version"]).stdout.toString().trim(); } catch { return ""; }
}

async function realTools(): Promise<any[]> {
  if (cachedTools) return cachedTools;
  const ver = cliVersion();
  if (ver) {
    try {
      const c = JSON.parse(readFileSync(TOOLS_CACHE_FILE, "utf8"));
      if (c.cli_version === ver && Array.isArray(c.tools) && c.tools.length) {
        cachedTools = c.tools;
        return cachedTools;
      }
    } catch { /* no cache yet */ }
    // one-shot child: ask for the list, then let it die (idle reaper / explicit kill)
    const ok = await ensureChild();
    if (ok && child) {
      const mine = `gate-tools-${Date.now()}`;
      await new Promise<any[]>((resolve) => {
        const timer = setTimeout(() => { taps.delete(mine); resolve([]); }, 20000);
        taps.set(mine, (payload) => { clearTimeout(timer); taps.delete(mine); resolve(payload?.tools ?? []); });
        try {
          child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method: "tools/list", params: {} }) + "\n");
        } catch { clearTimeout(timer); taps.delete(mine); resolve([]); }
      }).then((tools) => {
        if (tools.length) {
          cachedTools = tools;
          try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(TOOLS_CACHE_FILE, JSON.stringify({ cli_version: ver, tools })); } catch { /* cache write is best-effort */ }
        }
        killChild("tools listed");
      });
    }
  }
  return cachedTools ?? [];
}

// ---------------------------------------------------------------------------
// Client loop
// ---------------------------------------------------------------------------
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m: Msg;
  try { m = JSON.parse(line); } catch { return; }
  if (!m.method) return; // we never send requests upstream, so responses are not ours
  const id = m.id ?? null;
  const isNotification = m.id === undefined;
  const { method, params } = m;

  if (method === "initialize") {
    result(id, {
      protocolVersion: params?.protocolVersion || "2025-03-26",
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
      serverInfo: { name: "effectcraft-gate", version: "0.1.0" },
      instructions:
        "EffectCraft motion-graphics server behind the effectcraft-video gate. Locked by default: " +
        "it unlocks only for the Video Creator persona via `ob-plugin-effectcraft-video-mcp open`, " +
        "and re-locks on `close` or TTL expiry. While locked, tools/list is empty and every call is refused.",
    });
    return;
  }
  if (method === "ping") { if (!isNotification) result(id, {}); return; }

  const open = isOpen();

  if (method === "tools/list") {
    if (!LIST_WHILE_LOCKED && !open) { result(id, { tools: [] }); return; }
    realTools().then((tools) => result(id, { tools }));
    return;
  }
  if (method === "tools/call") {
    if (!open) {
      const hadSession = !!readSession();
      log(`refused tools/call (${hadSession ? "expired" : "locked"})`);
      errResult(id, hadSession ? EXPIRED_MSG : LOCK_MSG);
      return;
    }
    forward(id, method, params).then((sent) => {
      if (!sent) errResult(id, childCliPath() ? BACKEND_MSG : MISSING_MSG);
    });
    return;
  }
  if (method === "resources/list") {
    if (!open) { result(id, { resources: [] }); return; }
    forward(id, method, params).then((sent) => { if (!sent) result(id, { resources: [] }); });
    return;
  }
  if (method.startsWith("notifications/")) {
    if (open && child) { try { child.stdin!.write(JSON.stringify(m) + "\n"); } catch { /* ignore */ } }
    return;
  }
  if (isNotification) return;
  if (!open) { protoError(id, "effectcraft gate is locked"); return; }
  forward(id, method, params).then((sent) => { if (!sent) protoError(id, "effectcraft backend unavailable", -32000); });
});

rl.on("close", () => { killChild("client gone"); process.exit(0); });
process.on("SIGTERM", () => { killChild("sigterm"); process.exit(0); });
process.on("SIGINT", () => { killChild("sigint"); process.exit(0); });

log(`gate started (pid ${process.pid})`);
