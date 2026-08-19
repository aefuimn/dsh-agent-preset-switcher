/**
 * Build the static browser half (lib/client.js).
 *
 * The client bundle is deliberately hand-assembled: the DSH web shell serves
 * /plugins/<package>/client.js verbatim and expects the
 * window.__ModuleLoader__.load({ id, factory }) registration shape, with
 * dependencies resolved through require("@deepseek-ai/.../client") calls
 * (the boot graph materializes them lazily). No bundler required.
 *
 * Run: node scripts/build-client.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const BUNDLE_ID = pkg.name
const outFile = join(root, 'lib', 'client.js')

const BODY = `// dsh-mode-switcher browser half — session header "mode" control.
'use strict'

const React = require('react')
const { useState } = React

function SwitchModeButton(props) {
  const sessionId = props.sessionId
  const useSessions = props.useSessions
  const connection = props._connection
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  if (!connection) return null

  const listState = useSessions((s) => s)
  const summary = listState && sessionId ? listState.byId[sessionId] : undefined
  const current = summary ? summary.agentPreset : undefined
  const [roster, setRoster] = useState(null)

  const loadRoster = () => {
    connection.api.agentPresets.list({}).then((response) => {
      if (response.result && response.result.ok) setRoster(response.result.value.presets)
    }).catch(() => {})
  }
  React.useEffect(() => { loadRoster() }, [sessionId])

  const switchTo = async (id) => {
    setBusy(true)
    setError(null)
    setOpen(false)
    try {
      const result = await connection.rpc.call('/api', 'commands/execute', {
        agentId: sessionId,
        line: '/mode ' + id,
      })
      const r = result && result.ok ? result.value : result
      const executed = r && r.result
      if (executed && executed.kind === 'error') setError(String(executed.text || 'switch failed'))
      else loadRoster()
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  if (!roster || roster.length === 0) return null
  const label = roster.find((p) => p.id === current)
  const menuStyle = {
    position: 'absolute', zIndex: 50, right: 12, top: 40,
    background: '#1e1f26', color: '#e8e9ec', border: '1px solid #3a3d47',
    borderRadius: 8, padding: 6, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
  }
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        type: 'button',
        'data-dsh-mode-switcher': 'trigger',
        disabled: busy || open,
        onClick: () => setOpen(!open),
        style: { margin: '0 6px', padding: '2px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
      },
      busy ? '切换中…' : (label ? '模式：' + (label.name || label.id) : '切换模式'),
    ),
    open && React.createElement(
      'div',
      { 'data-dsh-mode-switcher': 'menu', style: menuStyle },
      roster.map((preset) =>
        React.createElement(
          'button',
          {
            key: preset.id,
            type: 'button',
            disabled: !!preset.broken || preset.id === current,
            onClick: () => switchTo(preset.id),
            style: {
              display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
              borderRadius: 6, border: 0, background: preset.id === current ? '#2b6cb0' : 'transparent',
              color: 'inherit', cursor: preset.broken ? 'not-allowed' : 'pointer', fontSize: 13,
            },
          },
          (preset.name || preset.id) + (preset.id === current ? '  ✓' : ''),
        ),
      ),
      error && React.createElement('div', { style: { marginTop: 6, color: '#ff7b72', fontSize: 12 } }, String(error)),
    ),
  )
}

function apply(ctx) {
  const slots = ctx.get('slots')
  const connection = ctx.get('connection')
  if (!slots || !connection) return
  const inject = () => ({ _connection: connection })
  try {
    slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'mode-switcher',
        order: -5,
        inject,
      },
      SwitchModeButton,
    )
  } catch (error) {
    console.error('[dsh-mode-switcher] header action registration failed:', error)
  }
}

exports.apply = apply
exports.inject = ['slots', 'connection']
return module.exports
`

const WRAPPED = 'window.__ModuleLoader__.load({\n' +
  '  id: ' + JSON.stringify(pkg.name) + ',\n' +
  '  factory: (require) => {\n' +
  '    var module = { exports: {} };\n' +
  '    var exports = module.exports;\n' +
  "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });\n" +
  BODY + '\n' +
  '  }\n' +
  '});\n' +
  '\n';

writeFileSync(outFile, WRAPPED)
console.log('wrote', outFile, WRAPPED.length, 'bytes')
