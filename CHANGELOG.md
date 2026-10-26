# Changelog

## 0.1.2 — 2026-10-26

- Docs: fixed the Install section of the README, which still described setup as
  downloading "the latest" EffectCraft release. Setup has pinned EffectCraft
  0.11.1 with SHA256 verification since 0.1.1; the README now says so in both
  places. No code change.

## 0.1.1 — 2026-10-19

- Security fix (marketplace review, closes #1): setup no longer queries the
  GitHub API for the latest `storytold/effectcraft` release. It now downloads
  one pinned release (EffectCraft 0.11.1, `effectcraft-0.11.1-linux-x86_64.deb`)
  and verifies its SHA256 (`6e12fd3c…3176a0`, matching that release's
  `SHA256SUMS.txt`) before `apt-get install`; a mismatch aborts the install.

## 0.1.0 — 2026-10-19

- First stable release: gated EffectCraft MCP for the Video Creator persona,
  lean/full tool profiles, vendored motion-design skill, ffmpeg post support.
