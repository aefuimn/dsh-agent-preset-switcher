# Hot reload

This package is intentionally **reload-safe**, and DSH already ships the two
reload mechanisms it needs. What you get out of the box today, and the two
small gaps you can close with this guide.

## What already reloads

**Browser half — no gap.** The web profile always mounts the official
`@deepseek-ai/dsh-client-hmr` row. Its node half polls every registered
client bundle every 500 ms, re-hashes the served
`/plugins/<id>/client.js`, and hot-swaps the bundle in every open page
(no refresh). The only reason it appears idle is "without a rebuild watcher
rewriting client bundles, the poll observes no changes and the chain stays
idle" (official comment in `dsh-client-hmr/lib/index.js`).

So a single dev watcher is enough:

```bash
node scripts/dev-client.mjs
```

It re-runs `scripts/build-client.mjs` on any change to
`scripts/build-client.mjs` or `package.json`. The next 500 ms poll of
`client-hmr` detects the changed bundle, invalidates it, prefetches the
rewritten one, and swaps the fiber — your header control updates **without a
page refresh**.

> This works today in the **installed** web profile too, as long as the
> built `lib/client.js` lands where the profile serves it (the profile
> resolves the bundle from its own `node_modules/dsh-agent-preset-switcher`).
> For a checkout-linked install the file is shared; for a copied install
> either copy the file after each build or make the watcher copy it (see
> the README § "Dev install (developing this plugin)").

## Host half — two gaps, one is optional

Host plugins load through `@deepseek-ai/cordis-plugin-hmr`, whose partial
reload re-imports a changed module, disposes the old fabric, and re-applies
the plugin with the same config. This package is already shaped for exactly
that:

- `ModeSwitcherService` keeps **all** state in per-instance maps — no
  module-level mutable state, no leaked listeners.
- `install()` is idempotent.
- Every registration the apply() mounts (the `ctx.modeSwitcher` property,
  the `/mode` command, the system-prompt section, the demo-preset sync
  effect) is wrapped in `ctx.effect()`, so a fiber unload cleans it
  completely and the next fiber starts clean.

Two environment gaps keep host HMR from being on by default in a web
deployment:

1. **The web bundle deliberately disables the shared host HMR row.**
   `dsh-web-app/cordis.patch.yml` contains:

   ```yaml
   # TODO: Re-enable shared HMR for Web after its reload lifecycle is tested.
   - id: hmr
     disabled: true
   ```

   Enabling it is a documented, supported loader operation (later patch
   layers win), but the official TODO means the web reload lifecycle is not
   yet blessed. Enable it only in a **dev profile** and expect to restart dsh
   if anything odd appears.

2. **Host HMR needs the Node internal module loader.**
   `cordis-plugin-hmr` refuses to start when
   `ctx.loader.internal` is null ("--expose-internals is required for HMR
   service"). `Loader.internal = ModuleLoader.fromInternal()` obtains it
   with `--expose-internals` on the command line, or through the
   `node-addon-require-builtin` addon. DSH ships that addon, so on
   **Node ≥ 22** (Node 24 tested) the loader is available even without the
   flag:
   ```js
   // node 24.18.0, dsh installed:
   require('node-addon-require-builtin').requireBuiltin('internal/modules/esm/loader')
     .getOrInitializeCascadedLoader()  // → ModuleLoader (v2)
   ```

## Enabling host HMR in a dev web profile

Put this in `~/.dsh/profiles/web/cordis.patch.yml` (the profile's own
patch layer; it is applied after every bundle patch, so it wins over the
web-app row that disables `hmr`):

```yaml
# Dev-only: re-enable the shared host HMR row the web bundle disables.
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
```

(Also available as `docs/hmr.patch.yml` in this repo: copy it into
`~/.dsh/profiles/web/` as the profile patch, or paste its contents into an
existing patch file.)

Then restart `dsh web` once, and check the startup log:

```text
watching [ '.' ] in /home/yc/.dsh/profiles/web
```

If you see `--expose-internals is required for HMR service`, the profile's
Node does not resolve the addon — either add
`--expose-internals` to the node invocation, or install the optional
platform package (`node-addon-require-builtin-<platform>`) into the
profile's node_modules.

## What host HMR reloads for this plugin

`cordis-plugin-hmr` watches the profile root, sees
`node_modules/dsh-agent-preset-switcher/lib/*.js` change, and partial-reloads
only the modules whose dependency graph changed. For a copied install, run the
normal build and then copy the new lib into the profile (or use the
`dsh plugin` refresh). The plugin fiber is disposed and re-applied with the
same config; because the plugin is reload-safe, sessions keep their armed
switch state only through what the host persists — in-flight armed switches
are process-local and are lost on a host reload (that is inherent to HMR,
not specific to this package).

## What still requires a restart

- **Adding or removing the plugin row** (the bundle patch): a layer re-read.
- **Changing `cordis.patch.yml` itself**: a config reload, which is
  separate from module HMR (the CLI also watches user patches).
- **Changing the web profile's bundle list** (`package.json`
  `dsh.profile.bundles`): a full `dsh web` restart.
- **Standing preset compositions** (files under `$DSH_HOME/.agent-presets`)
  are read fresh on the next `agentPresets.recompose` (stamp-checked), so
  editing a preset's `agent.cordis.yml` takes effect on the next hot switch
  or new session — no reload of this plugin is needed.

## Cost and risk

- Host HMR is the official mechanism, but the web bundle keeps it disabled
  behind a TODO. Use it in dev profiles; keep production on the restart
  flow until the official web reload lifecycle is tested.
- HMR re-imports modules: a syntax error in `lib/index.js` makes the
  partial reload fail loudly (code-frame logs, no silent crash) and the old
  composition stays.
- Client HMR carries no such caveat: the browser half is a self-contained
  bundle and hot-swaps cleanly.
