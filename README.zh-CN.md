# dsh-agent-preset-switcher

[English](./README.md)

让 DSH 会话支持**热切换工作模式**（agent preset）——从「创建会话前选择」变成「会话中随时切换」。

## 它解决什么

DSH 的 agent preset（标准模式 / 极简模式 / PTC 模式 / 自定义预设）决定了一个会话 Agent 的**工具目录、系统提示词、能力集**。官方设计里 preset 在会话开始前选定，一旦产生过 `turn/start` 就禁止更换：

- 官方浏览器 RPC `agentPresets.select` 前检查 `sessionBlank(agent.session)`，非空白返回 `agent-preset-locked`；
- 理由：历史 transcript 是在旧工具集下生成的，中途换工具会导致「日志里记录的工具调用，新组合无法调用」的不一致。

本插件把这条通道扩展为**任意阶段的会话热切换**：切换只发生在 **step 边界**（一个模型请求完成后、下一请求组装前），并复用官方同一套机制 —— `AgentPresets.recompose()`（standing preset 单飞挂载 + roster 持有的 scope-parent binding 重链接）。

## 快速上手

### 从 GitHub 安装（其他用户推荐）

仓库已包含编译产物（\`lib/\`），无需本地构建，直接用 \`dsh plugin\` 安装：

```bash
# SSH 方式（需要已配置 GitHub SSH key）
dsh plugin --profile web add "git+ssh://git@github.com/aefuimn/dsh-agent-preset-switcher.git"

# 或 HTTPS 方式（无需 SSH key）
dsh plugin --profile web add "git+https://github.com/aefuimn/dsh-agent-preset-switcher.git"
```

然后重启 dsh web 进程并刷新页面：

```bash
# 重启你的 dsh web 服务，再硬刷新浏览器标签页
```

### 从本地目录安装（开发本插件时）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-agent-preset-switcher
# 重启 dsh web 并刷新浏览器标签页
```

### 验证

- 会话 header 多一个**「切换模式」**按钮（browser half，通过官方 `conversation.session.header.actions` 槽位注册）；
- 任意会话内可执行 **`/mode list`** 与 **`/mode <预设id>`**；
- 插件自带一个演示 preset `mode-switcher-standard`（"热切换验证模式"），启动时同步到 `$DSH_HOME/.agent-presets`，方便立即验证；
- `dsh plugin --profile web ls` 应能看到 `dsh-agent-preset-switcher` 已安装。
## 组件

```
dsh-agent-preset-switcher/
├── package.json               # dsh 插件 manifest（host + client 双面）
├── cordis.patch.yml           # bundle patch：插入插件行
├── src/
│   ├── index.ts               # 宿主面：服务注册 + /mode 命令 + 通告 + 演示预设同步
│   ├── switcher.ts            # 热切换核心（armed → step 边界 recompose）
│   └── dsh-home.ts            # ~/.dsh 解析
├── scripts/
│   └── build-client.mjs       # 生成 lib/client.js（静态 ModuleLoader 包）
├── lib/
│   ├── index.js / switcher.js / dsh-home.js   # tsc 产物
│   └── client.js              # 浏览器面静态包
└── presets/mode-switcher-standard/
    ├── agent.cordis.yml
    └── preset.yml
```

## 热切换原理

### 触发

所有请求最终都调用 `ctx.modeSwitcher.request(sessionId, presetId)`。当前入口：

1. **浏览器 header 按钮**：读取 `agentPresets.list` 出 roster，点击后经 `connection.rpc.call('/api','commands/execute',{agentId, line:'/mode <id>'})` 触发；
2. **`/mode` 斜杠命令**：`/mode list` 列出当前预设与全 roster，`/mode <id>` 请求切换。

请求是「武装（armed）」而非立即动作：`mode-switcher/requested` 事件发出，目标预设先 resolve 校验。

### 应用（step 边界）

```
request(sessionId, targetId)
  └─ armed（latest wins；同一会话重复请求后到覆盖先到）
       │
       ▼  agent/pre-step（下一个模型请求组装前）
  └─ pop armed
       ├─ 目标 == 当前     → no-op（不写日志、不重链接）
       ├─ agentPresets.recompose(agent.ctx, targetId)
       │     └─ ensureStanding(target)（单飞） → 持有 binding.rebind(standing.key)
       ├─ agent.session.append('agent-preset/selected', …)   # 官方日志事件
       ├─ mode-switcher/switched 事件
       └─ 放行 step（新组合的 section/tool 从下一请求生效）
```

关键点：

- **不是 unmount/remount**：standing 组合永久、共享；切换只搬 agent scope 的父链接。
- **日志诚实**：`agent-preset/selected` 与重链接一致写入日志，resume/fork 用 `resolveSessionPreset` 读最新事件重建组合，浏览器既有 `agent-preset/selected` 监听自动刷新。
- **失败语义**：recompose 抛错 => 什么都不动，发出 `mode-switcher/switch-failed`，step 照常进行。
- **幂等与并发**：同会话切换经 per-session promise 链串行化；与当前相同则为 no-op。
- **子代理**：保持宿主规则，子代理会话拒绝切换（其组合跟随父会话）。

## 浏览器面

- 注册到官方槽位 `conversation.session.header.actions`（list 槽，`order: -5`，紧挨官方 preset label）。
- 下拉列出 deployment 全部 preset（含 name/description/broken），当前项打勾禁用；
- 点击即武装切换；成功后 roster 重读，busy/error 状态就地反馈；
- 失败不弹窗不打断。

## API（宿主）

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    modeSwitcher: ModeSwitcherService
  }
}
```

- `modeSwitcher.request(sessionId, presetId)` → `{accepted:true,pending:true} | {accepted:false,reason}`
- 事件：`mode-switcher/requested`、`mode-switcher/switched`、`mode-switcher/switch-failed`

## 与官方 recompose 的一致性

官方空白会话切换（`agentPresets.select`）的步骤是：

```
presets.recompose(agent.ctx, id)  // ensureStanding + binding.rebind
agent.session.append('agent-preset/selected', { agentPreset: preset.id })
```

本插件在非空白阶段做完全相同的两步，只是把调用时机从「请求到来时」移到 `agent/pre-step` 水瀑内部（模型请求之间）。`recompose` 的注释明确 *the CALLER owns the blank check*——官方 RPC 选择用 blank 检查，本插件选择用 step 边界，机制本身是同一套。

## 构建

```bash
npm install                 # 安装 devDependencies（宿主类型）
npm run build               # tsc 编译 host 面 + node scripts/build-client.mjs 生成浏览器面
```

浏览器面是手写的静态 `window.__ModuleLoader__.load` 包（不依赖 bundler），通过 boot graph 的 `require('react')` 与既有 wire API 工作，避免引入额外构建链路。

## 限制与后续

- **step 边界语义**：切换不打断当前模型请求；最长等待 = 当前 step 完成。
- **transcript 一致性**：切换发生在模型请求之间，工具 schema/提示词在 step 边界更换；历史消息原样保留（这是热切换的价值，也是其边界）。
- 可扩展：给 `src/index.ts` 的 service 增加 browser RPC（在 host-apiproxy 之外挂 Typert/远程面）即可让未来面直接遥调用，当前 UI 走已有的 `commands/execute` 通道，宿主零新增 wire。

## 协议

[MIT](./LICENSE)
