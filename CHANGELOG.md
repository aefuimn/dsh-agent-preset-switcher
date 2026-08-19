# Changelog

All notable changes to **dsh-agent-preset-switcher** are documented here.

## [0.1.0] - 2026-02-18

Initial release.

### Added

- Hot-switch agent presets inside a running DSH session.
- Switch requests are armed immediately and applied at the next `agent/pre-step`
  boundary via the official `AgentPresets.recompose` path.
- Official `agent-preset/selected` session log event after each successful switch.
- `/mode list` and `/mode <preset-id>` slash commands.
- Browser session-header mode control (registered into
  `conversation.session.header.actions`).
- Bundled demo preset `mode-switcher-standard`, synced into `$DSH_HOME/.agent-presets`.
- Bilingual README (EN + zh-CN), MIT license, publishing guide.
