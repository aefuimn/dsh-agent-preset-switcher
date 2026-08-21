/**
 * dsh-agent-preset-switcher — host half.
 *
 * Registers the step-boundary hot-switch service (ctx.modeSwitcher) and a
 * human-facing /mode slash command that arms a switch. The switch is applied
 * at the next agent/pre-step boundary through the official
 * agentPresets.recompose path. No browser half: switching happens purely via
 * /mode (list | <preset-id>).
 */

import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ModeSwitcherService, type RequestOutcome } from './switcher.js'

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

/** Plugin config; defaults are applied in apply() when fields are absent. */
export interface Config {
  /** Master switch: when false, neither service, command, nor announcement runs. */
  enabled?: boolean
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
}

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 151

/** Model-facing announcement: plugin presence, principle, and limits. */
export const MODE_SWITCHER_GUIDANCE =
  '本机已安装 dsh-agent-preset-switcher 插件（会话工作模式热切换）：会话运行中可随时用 /mode list 查看、/mode <预设id> 切换 agent preset（工作模式）；切换在下一个 step 边界生效，不中断当前模型请求，工具目录与系统提示词随之更换，历史 transcript 保持不变。预设即 DSH agent preset（标准/极简/code/自定义），会话内切换通过官方 recompose 机制完成。'

/** Apply: register service and /mode command. */
export function apply(ctx: Context, config?: Config): void {
  const resolve = (): Config => ({
    enabled: config?.enabled ?? true,
    announceToAgent: config?.announceToAgent ?? true,
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
