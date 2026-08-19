/**
 * dsh-mode-switcher — host half.
 *
 * Registers the step-boundary hot-switch service (ctx.modeSwitcher), a
 * human-facing /mode slash command that arms a switch, and a system-prompt
 * announcement. The bundled example preset is synced into
 * $DSH_HOME/.agent-presets on startup so the demo mode is immediately
 * selectable.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from 'schemastery'
import { ModeSwitcherService, type RequestOutcome } from './switcher.js'
import { dshHome } from './dsh-home.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Hot-switch orchestrator: arm per-session preset switches. */
    modeSwitcher: ModeSwitcherService
  }
}

/** Stable cordis plugin name. */
export const name = 'mode-switcher'

/** The command runtime and prompt assembly must exist first. */
export const inject = ['commands', 'systemPrompt', 'agents']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch: when false, neither service, command, nor announcement runs. */
  enabled?: boolean
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Sync the bundled demo preset into the harness-home preset root. */
  syncDemoPreset?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  syncDemoPreset: z.boolean().default(true),
})

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 151

/** Model-facing announcement: plugin presence, principle, and limits. */
export const MODE_SWITCHER_GUIDANCE =
  '本机已安装 dsh-agent-preset-switcher 插件（会话工作模式热切换）：会话运行中可随时用 /mode list 查看、/mode <预设id> 切换 agent preset（工作模式）；切换在下一个 step 边界生效，不中断当前模型请求，工具目录与系统提示词随之更换，历史 transcript 保持不变。预设即 DSH agent preset（标准/极简/code/自定义），会话内切换通过官方 recompose 机制完成。'

/** Absolute path of the bundled preset tree inside this package. */
export function bundledPresetsRoot(): string {
  return fileURLToPath(new URL('../presets/', import.meta.url))
}

/** Copy one directory tree recursively (simple, preserved timestamps). */
function copyDirSync(source: string, target: string): void {
  if (existsSync(target) && !statSync(target).isDirectory()) rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyDirSync(from, to)
    else copyFileSync(from, to)
  }
}

/** Sync the demo preset into the harness-home root (best-effort). */
function syncDemoPreset(ctx: Context): void {
  const source = join(bundledPresetsRoot(), 'mode-switcher-standard')
  const targetRoot = join(dshHome(), '.agent-presets')
  const target = join(targetRoot, 'mode-switcher-standard')
  try {
    mkdirSync(targetRoot, { recursive: true })
    copyDirSync(source, target)
    ctx.logger?.info?.('dsh-mode-switcher: demo preset synced into ' + target)
  } catch (error) {
    ctx.logger?.warn?.('dsh-mode-switcher: demo preset sync failed: ' + (error instanceof Error ? error.message : String(error)))
  }
}

/** Apply: register service, /mode command, announcement, demo sync. */
export function apply(ctx: Context, config?: Config): void {
  const resolve = (): Config => ({
    enabled: config?.enabled ?? true,
    announceToAgent: config?.announceToAgent ?? true,
    syncDemoPreset: config?.syncDemoPreset ?? true,
  })
  if (!resolve().enabled) return

  const service = new ModeSwitcherService(ctx)
  ctx.effect(() => {
    Object.defineProperty(ctx, 'modeSwitcher', {
      value: service,
      enumerable: true,
      configurable: true,
    })
    return () => {
      Object.defineProperty(ctx, 'modeSwitcher', { value: undefined, enumerable: true, configurable: true })
    }
  }, 'mode-switcher: service')

  service.install()

  if (resolve().syncDemoPreset) syncDemoPreset(ctx)

  const commands = ctx.get('commands')
  if (commands !== undefined) {
    ctx.effect(() => commands.register({
      name: 'mode',
      description: "Hot-switch this session's working mode (agent preset) at the next step boundary. Usage: /mode list | /mode <preset-id>",
      input: { hint: 'list | <preset-id>' },
      handler: async ({ agent, rawInput }) => {
        const input = rawInput.trim()
        if (input === 'list' || input === '') {
          const presets = ctx.get('agentPresets')
          if (presets === undefined) {
            return { kind: 'success' as const, text: 'this deployment composes no agent presets' }
          }
          const current = service.currentPresetId(agent)
          const rows: AgentPreset[] = await presets.list()
          const lines = rows.map((preset) =>
            `- ${preset.id}${preset.broken !== undefined ? ' (broken: ' + preset.broken + ')' : ''}${preset.id === current ? '  ← current' : ''}`,
          )
          return { kind: 'success' as const, text: [`current mode: ${current ?? '(no preset)'}`, ...lines].join('\n') }
        }
        const outcome: RequestOutcome = await service.request(agent.id, input)
        if (!outcome.accepted) {
          return { kind: 'error' as const, text: outcome.reason }
        }
        return { kind: 'success' as const, text: `mode switch to "${input}" armed; it takes effect at the next step boundary.` }
      },
    }), 'mode-switcher: /mode command')
  }

  let disposeSection: (() => void) | undefined
  const refresh = (): void => {
    disposeSection?.()
    disposeSection = undefined
    if (!resolve().announceToAgent) return
    const prompt = ctx.get('systemPrompt')
    if (prompt === undefined) return
    disposeSection = prompt.section({
      name: 'plugin:dsh-mode-switcher',
      order: SECTION_ORDER,
      text: MODE_SWITCHER_GUIDANCE,
    })
  }
  refresh()
  ctx.effect(() => () => {
    disposeSection?.()
    disposeSection = undefined
  }, 'mode-switcher: announcement')
}
