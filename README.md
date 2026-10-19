# EffectCraft Video

Motion-graphics videos for open-bot, driven by the **Video Creator** persona through
[EffectCraft](https://github.com/storytold/effectcraft) — an open-source, After Effects-class
compositor written in Rust — running **headlessly** over its MCP server.

## What it does

- Animated titles, lower thirds, logo stings, kinetic text, compositing, explainers.
- Comps, layers, keyframes, 306 effects, expressions, render queue.
- Export h264 MP4, ProRes, WebM, Lottie. Pure-Rust encoders, no ffmpeg dependency.
- CPU rendering (works on any desktop, no GPU needed).

## The persona gate (the point of this plugin)

The EffectCraft MCP server is registered on the desktop, but it sits behind a **token gate**
(`gate/gate.ts`) and is **locked by default**:

| State | tools/list | tools/call |
|---|---|---|
| Locked (default) | `[]` — zero tools visible | refused with instructions |
| Open (Video Creator session) | full EffectCraft toolset | proxied to EffectCraft |

A session is opened only with the plugin CLI, meant to run in a Video Creator thread:

```sh
ob-plugin-effectcraft-video-mcp open     # unlocks for ttl_minutes (default 120)
ob-plugin-effectcraft-video-mcp close    # locks again — always do this after delivery
ob-plugin-effectcraft-video-mcp status   # state, version, gate log tail
```

`opencode.agentsMd` carries the standing rule (Video Creator only), `agentTools` hides the
tools from the built-in subagents, and only the `effectcraft-worker` agent is allowed to use
them — for pipeline-style jobs orchestrated from a Video Creator thread.

> Honest scope: the desktop runs one shared opencode daemon, so no per-thread hard isolation
> exists in the platform. The gate enforces default-locked + explicit unlock + auto-expiry —
> the strongest enforcement available; it is policy-grade, not a security boundary.

## Install

```sh
ob-plugin install effectcraft-video        # marketplace (when published)
ob-plugin install --path ~/plugins-create/effectcraft-video   # local dev
```

Setup downloads the latest EffectCraft `.deb` from GitHub releases and installs it with
`apt-get` (idempotent; skips if `effectcraft-cli` is already present). Needs network access
once. Reinstalling the plugin re-runs setup only if the CLI is missing.

## Settings

| Key | Default | What it does |
|---|---|---|
| `ttl_minutes` | `120` | How long an open session stays unlocked before auto-expiring (5–1440). |
| `autosave` | `true` | Passes `--autosave` to the headless server so unsaved work is checkpointed. |
| `tool_profile` | `lean` | `lean` exposes 17 workflow tools (lighter context); `full` exposes all 27. Non-listed features stay reachable via `execute_command`. |

No vault keys, no secrets, no accounts.

## Files

- `gate/gate.ts` — the MCP stdio gate (lazy-spawns `effectcraft-cli mcp`, idle-reaps after 15 min).
- `tools/video.ts` — the `ob-plugin-effectcraft-video-mcp` CLI (open / close / status).
- `setup/install.sh` — idempotent EffectCraft installer.

## Notes

- EffectCraft is alpha software (first release October 2026) and moves fast; setup always
  installs the latest release. Behaviours can change upstream between versions.
- First MCP use spawns a headless EffectCraft on the CPU; startup is instant, long renders are not.
- EffectCraft and Adobe After Effects are unrelated; EffectCraft is an independent open-source project.
