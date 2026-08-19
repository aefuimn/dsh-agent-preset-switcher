# dsh-agent-preset-switcher

[中文文档](./README.zh-CN.md)

Hot-switch **agent presets (working modes)** inside a running DSH session, instead of choosing a preset only when a session is created.

## What it solves

A DSH agent preset (Standard / Minimal / PTC / any custom preset) decides a session agent's **tool catalog, system prompt, and capabilities**. Officially the preset is fixed once a session starts (`turn/start` exists):

- the browser RPC `agentPresets.select` checks `sessionBlank(agent.session)` and returns `agent-preset-locked` for started sessions;
- the reason: history transcripts were generated under the old tool set, and swapping tools mid-conversation would leave logged tool calls that the new composition cannot make.

This plugin turns that channel into **hot-switching at any stage**: a switch is applied only at a **step boundary** (after one model request finishes, before the next one is assembled), reusing the exact official mechanism — `AgentPresets.recompose()` (single-flight standing preset mounts + the scope-parent binding re-link held by the roster).

## Quick start

### Install from GitHub (recommended for everyone else)

The repo ships build artifacts (\`lib/\`), so no local build is needed. Install it as a plugin bundle with \`dsh plugin\`:

```bash
# SSH (clone/install over SSH; requires your GitHub SSH key)
dsh plugin --profile web add "git+ssh://git@github.com/aefuimn/dsh-agent-preset-switcher.git"

# or HTTPS (no SSH key needed; a read token may be required for private repos)
dsh plugin --profile web add "git+https://github.com/aefuimn/dsh-agent-preset-switcher.git"
```

Then restart the dsh web process and refresh the page:

```bash
# restart your dsh web server, then hard-refresh the browser tab
```

### Install from a local checkout (developing this plugin)

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-agent-preset-switcher
# restart dsh web and refresh the browser tab
```

### Verify

- every session header gains a **「切换模式 / Switch mode」** button (browser half, registered into the official `conversation.session.header.actions` slot);
- any session accepts **`/mode list`** and **`/mode <preset-id>`** slash commands;
- a demo preset `mode-switcher-standard` ("Hot-switch verification mode") is synced into `$DSH_HOME/.agent-presets` on startup so the feature is testable immediately;
- `dsh plugin --profile web ls` should list `dsh-agent-preset-switcher` among the installed packages.
## Layout

```
dsh-agent-preset-switcher/
├── package.json               # dsh plugin manifest (host + client halves)
├── cordis.patch.yml           # bundle patch that inserts the plugin row
├── src/
│   ├── index.ts               # host half: service registration, /mode command, announcement, demo preset sync
│   ├── switcher.ts            # hot-switch core (armed -> step-boundary recompose)
│   └── dsh-home.ts            # $DSH_HOME resolution
├── scripts/
│   └── build-client.mjs       # generates lib/client.js (static ModuleLoader bundle)
├── lib/
│   ├── index.js / switcher.js / dsh-home.js   # tsc output
│   └── client.js              # static browser-half bundle
└── presets/mode-switcher-standard/
    ├── agent.cordis.yml
    └── preset.yml
```

## How it works

### Triggering

Every path funnels into `ctx.modeSwitcher.request(sessionId, presetId)`. Current entries:

1. **Browser header button** — reads the roster via `agentPresets.list`, then fires `connection.rpc.call('/api','commands/execute',{agentId, line:'/mode <id>'})`;
2. **`/mode` slash command** — `/mode list` shows the current preset and full roster; `/mode <id>` requests a switch.

A request **arms** the switch (emitting `mode-switcher/requested` after resolving the target preset) rather than applying it immediately.

### Applying (step boundary)

```
request(sessionId, targetId)
  └─ armed (latest wins; repeat requests overwrite)
       │
       ▼  agent/pre-step (before the next model request is assembled)
  └─ pop armed
       ├─ target == current   → no-op (no log event, no re-link)
       ├─ agentPresets.recompose(agent.ctx, targetId)
       │     └─ ensureStanding(target) (single-flight) → binding.rebind(standing.key)
       ├─ agent.session.append('agent-preset/selected', …)   # official log event
       ├─ mode-switcher/switched event
       └─ delegate to the default step (new sections/tools apply to the next request)
```

Key points:

- **Not an unmount/remount**: standing mounts are permanent and shared; the switch only moves the agent scope's parent link.
- **Honest logging**: `agent-preset/selected` is appended together with the re-link, so resume/fork rebuild the same composition via `resolveSessionPreset`, and existing browser `agent-preset/selected` listeners refresh.
- **Failure semantics**: if `recompose` throws, nothing changes; `mode-switcher/switch-failed` is emitted and the step proceeds with the old composition.
- **Idempotency & concurrency**: switches for one session are serialized through a per-session promise chain; same-target requests are no-ops.
- **Subagents**: host rules are preserved — subagent sessions cannot be switched (their composition follows the parent).

## Browser half

- Registers into the official slot `conversation.session.header.actions` (list slot, `order: -5`, right next to the official preset label).
- The dropdown lists every preset the deployment supplies (name/description/broken), with the current one checked and disabled.
- Clicking arms the switch; the roster is re-read after success; busy/error state is shown inline.
- A failed registration never takes the GUI down.

## Host API

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    modeSwitcher: ModeSwitcherService
  }
}
```

- `modeSwitcher.request(sessionId, presetId)` → `{accepted:true,pending:true} | {accepted:false,reason}`
- Events: `mode-switcher/requested`, `mode-switcher/switched`, `mode-switcher/switch-failed`

## Consistency with the official recompose path

The official blank-session switch (`agentPresets.select`) does:

```
presets.recompose(agent.ctx, id)  // ensureStanding + binding.rebind
agent.session.append('agent-preset/selected', { agentPreset: preset.id })
```

This plugin performs the exact same two steps for a non-blank session — it only moves the moment from "when the request arrives" to inside the `agent/pre-step` waterfall (between model requests). The `recompose` docs explicitly state *the CALLER owns the blank check*: the official RPC chooses the blank check, this plugin chooses the step boundary; the mechanism is the same.

## Build

```bash
npm install            # dev dependencies (host types)
npm run build          # tsc for the host half + node scripts/build-client.mjs for the browser half
```

The browser half is a hand-written static `window.__ModuleLoader__.load` bundle (no bundler), working through the boot graph's `require('react')` and existing wire APIs.

## Limitations & follow-ups

- **Step-boundary semantics**: a switch never interrupts the current model request; the longest wait is until the current step finishes.
- **Transcript consistency**: switching happens between model requests; tool schemas/prompt sections change at the step boundary while history stays as-is (that is the value — and the boundary — of hot switching).
- Future: the service in `src/index.ts` can gain a browser RPC (Typert/remote face) so future surfaces can call it directly; the current UI goes through the existing `commands/execute` channel, so the host adds zero new wire.

## License

[MIT](./LICENSE)
