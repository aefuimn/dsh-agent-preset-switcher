/**
 * Harness-home resolution shared with the plugin family: DSH_HOME override,
 * platform-home fallback, and ~ expansion. A relative DSH_HOME resolves
 * against the process CWD (absolute), which is the shared contract.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

let cached: string | undefined

/** The absolute harness-home directory (default: ~/.dsh). */
export function dshHome(): string {
  if (cached !== undefined) return cached
  const override = process.env.DSH_HOME
  const home = override !== undefined && override !== ''
    ? (override === '~' || override.startsWith('~/') ? join(homedir(), override.slice(1)) : override)
    : join(homedir(), '.dsh')
  cached = resolve(home)
  return cached
}
