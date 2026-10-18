# Config guide — effectcraft-video

## What this plugin needs

Almost nothing: no accounts, no API keys, no vault slugs. It downloads and installs the
EffectCraft `.deb` (GitHub releases) at install time, then drives it headlessly. The only
settings below tune the session gate.

## Settings (Plugins tab → effectcraft-video → Settings)

| Key | Default | Ask the user |
|---|---|---|
| `ttl_minutes` | `120` | "How long should a Video Creator session stay unlocked?" 120 min suits a typical project; raise it for long render queues (max 1440 = 24 h). |
| `autosave` | `true` | Leave on unless the user explicitly wants no checkpoints — it protects unsaved headless work across gate restarts. |

## Vault keys

None. Nothing to fill.

## Verification (prove it works)

1. `ob-plugin-effectcraft-video-mcp status` → expect `effectcraft: 0.x.y` (not "not installed")
   and `gate: LOCKED`.
2. `effectcraft-cli --version` → prints a version (setup succeeded).
3. In a **Video Creator** thread: `ob-plugin-effectcraft-video-mcp open` → `OPEN (N min left)`;
   call any effectcraft MCP tool (e.g. `get_state`) → it answers.
4. `ob-plugin-effectcraft-video-mcp close` → `LOCKED`; the same MCP call now refuses with the
   lock message. That refusal is the gate working as designed.
5. Optional smoke test: the `effectcraft-doctor` skill renders one PNG headless.

## Troubleshooting

- **"effectcraft-cli is NOT installed"** → reinstall the plugin (`ob-plugin install
  effectcraft-video`); its setup downloads the deb. Check `~/.open-bot/plugin-init/effectcraft-video.log`.
- **Gate OPEN but tools fail** → `status` prints the gate log tail; `[ec]` lines are
  EffectCraft's own stderr.
- **Tools never appear in a thread** → sessions unlock per thread start: open the gate, then
  start (or restart) the Video Creator thread.
