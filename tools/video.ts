#!/usr/bin/env bun
// effectcraft-video — session-lock CLI for the EffectCraft MCP gate.
//
//   ob-plugin-effectcraft-video open [--ttl N]   unlock the MCP for this thread's work
//   ob-plugin-effectcraft-video close            lock it again (always do this after rendering)
//   ob-plugin-effectcraft-video status           lock state, EffectCraft version, gate log tail
//
// The gate (MCP server) reads ~/.open-bot/plugin-effectcraft-video/session.json;
// this CLI is the only writer. No secrets involved.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const HOME = process.env.HOME || "/home/agent";
const STATE_DIR = `${HOME}/.open-bot/plugin-effectcraft-video`;
const SESSION_FILE = `${STATE_DIR}/session.json`;
const LOG_FILE = `${STATE_DIR}/gate.log`;
const CONFIG_FILE = `${HOME}/.config/open-bot/plugin-effectcraft-video.json`;

function settings(): Record<string, string> {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")).settings || {}; } catch { return {}; }
}
function defaultTtlMinutes(): number {
  const n = Number(settings().ttl_minutes ?? 120);
  return Number.isFinite(n) && n > 0 ? n : 120;
}
function cliPath(): string | null { return Bun.which("effectcraft-cli"); }
function cliVersion(): string {
  const p = cliPath();
  if (!p) return "not installed";
  try {
    const r = Bun.spawnSync([p, "--version"]);
    return r.stdout.toString().trim() || "installed (version unknown)";
  } catch { return "installed (version check failed)"; }
}
function session(): { expires: number } | null {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return typeof s.expires === "number" ? s : null;
  } catch { return null; }
}
function isOpen(): boolean { const s = session(); return !!s && s.expires > Date.now(); }
function gateLogTail(lines = 8): string[] {
  try {
    return readFileSync(LOG_FILE, "utf8").trimEnd().split("\n").slice(-lines);
  } catch { return []; }
}

const [, , cmd = "status"] = process.argv;

if (cmd === "open") {
  const ttlIdx = process.argv.indexOf("--ttl");
  const explicit = ttlIdx > -1 ? Number(process.argv[ttlIdx + 1]) : undefined;
  const minutes = Math.min(1440, Math.max(1, explicit && Number.isFinite(explicit) ? explicit : defaultTtlMinutes()));
  if (!cliPath()) {
    console.error("effectcraft-cli is NOT installed. Reinstall the plugin (its setup installs the EffectCraft deb), then retry.");
    process.exit(1);
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const expires = Date.now() + minutes * 60_000;
  writeFileSync(SESSION_FILE, JSON.stringify({ expires, openedAt: new Date().toISOString() }, null, 2));
  console.log(`EffectCraft MCP session OPEN for ${minutes} min (until ${new Date(expires).toISOString()}).`);
  console.log("Work through the effectcraft MCP tools, then run `ob-plugin-effectcraft-video-mcp close` when the render is delivered.");
  process.exit(0);
}

if (cmd === "close") {
  try { rmSync(SESSION_FILE); } catch { /* already closed */ }
  console.log("EffectCraft MCP session CLOSED (gate locked).");
  process.exit(0);
}

if (cmd === "gate") {
  // Fallback endpoint: speak MCP JSON-RPC (one message per line) through the gate's lock.
  // For threads whose tool list does not show effectcraft_* yet (e.g. right after install,
  // before the desktop restarts). Same enforcement as the registered MCP server.
  const gate = `${process.env.HOME || "/home/agent"}/.open-bot/plugin-effectcraft-video/gate.ts`;
  const gatePath = existsSync(gate) ? gate : "/usr/local/bin/ob-plugin-effectcraft-video-gate.ts";
  const child = Bun.spawn(["bun", gatePath], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}

if (cmd === "status") {
  const s = session();
  const open = isOpen();
  const minsLeft = open && s ? Math.max(0, Math.round((s.expires - Date.now()) / 60_000)) : 0;
  console.log(`gate:        ${open ? `OPEN (${minsLeft} min left)` : s ? "EXPIRED (run open again)" : "LOCKED"}`);
  console.log(`effectcraft: ${cliVersion()}`);
  console.log(`settings:    ttl_minutes=${settings().ttl_minutes ?? "120 (default)"} autosave=${settings().autosave ?? "true (default)"}`);
  const tail = gateLogTail();
  if (tail.length) console.log(`gate.log (last ${tail.length}):\n  ` + tail.join("\n  "));
  process.exit(0);
}

console.error("usage: ob-plugin-effectcraft-video-mcp open [--ttl N] | close | status | gate");
process.exit(2);
