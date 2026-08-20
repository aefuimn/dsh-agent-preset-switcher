/**
 * Dev watcher for the browser half (lib/client.js).
 *
 * Rebuilds lib/client.js whenever scripts/build-client.mjs or package.json
 * changes, so the already-mounted dsh-client-hmr row (500 ms poll over the
 * served /plugins/<id>/client.js bundle) hot-reloads the header control in
 * the open web page — no manual copy, no page refresh, no dsh restart.
 *
 * Usage:  node scripts/dev-client.mjs        (foreground)
 *         node scripts/dev-client.mjs &      (background; keep alive)
 */
import { watch, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const signals = new Set()
let timer

function rebuild() {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    const child = spawn(process.execPath, ['scripts/build-client.mjs'], {
      cwd: root,
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code !== 0) console.error(`[dev-client] build exited ${code}`)
      else console.log('[dev-client] rebuilt lib/client.js — client-hmr should hot-swap it')
    })
  }, 60)
}

const onEvent = (event, filename) => {
  if (filename !== 'package.json' && filename !== 'scripts/build-client.mjs') return
  const key = event + ':' + filename
  if (signals.has(key)) return
  signals.add(key)
  setTimeout(() => signals.delete(key), 150)
  rebuild()
}

watch(root, { recursive: false }, onEvent)

// Poll fallback for filesystems where directory watch events are unreliable.
let last = new Map()
setInterval(() => {
  for (const file of ['package.json', 'scripts/build-client.mjs']) {
    try {
      const st = statSync(file)
      const prev = last.get(file)
      if (prev && (st.mtimeMs !== prev.mtimeMs || st.size !== prev.size)) rebuild()
      last.set(file, { mtimeMs: st.mtimeMs, size: st.size })
    } catch { /* file may be mid-write */ }
  }
}, 250)

console.log('[dev-client] watching scripts/build-client.mjs and package.json; Ctrl-C to stop')
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
