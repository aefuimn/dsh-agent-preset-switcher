import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ModeSwitcherService } from '../lib/switcher.js'

function makeFixture(initial = 'standard') {
  const events = []
  const recomposed = []
  const appended = []
  let current = initial
  const agent = {
    id: 's1',
    ctx: {},
    session: { header: {}, append: (type, data) => appended.push([type, data]) },
  }
  const presets = {
    async resolve(id) {
      if (id === 'missing') throw new Error('unknown preset')
      return { id }
    },
    async recompose(_agentCtx, id) {
      recomposed.push(id)
      current = id
      return { id }
    },
    composedPreset() { return current },
  }
  const ctx = {
    agents: {
      get: (id) => (id === 's1' ? agent : undefined),
      isOwnedBy: () => false,
    },
    get: (key) => (key === 'agentPresets' ? presets : undefined),
    on: () => () => {},
    emit: (name, ...args) => events.push([name, ...args]),
  }
  return {
    agent, events, recomposed, appended, ctx,
    get current() { return current },
    set current(v) { current = v },
  }
}

test('request rejects unknown preset with fast-fail', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  const outcome = await svc.request('s1', 'missing')
  assert.deepEqual(outcome, { accepted: false, reason: 'unknown agent preset "missing"' })
  assert.equal(svc.armedFor('s1'), undefined)
})

test('request arms a switch for a live session', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  const outcome = await svc.request('s1', 'code')
  assert.deepEqual(outcome, { accepted: true, pending: true })
  assert.equal(svc.armedFor('s1'), 'code')
  assert.deepEqual(fx.events, [['mode-switcher/requested', 's1', 'code']])
})

test('request rejects unknown session', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  const outcome = await svc.request('ghost', 'code')
  assert.equal(outcome.accepted, false)
})

test('pre-step applies the armed switch and logs official event', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  await svc.request('s1', 'code')
  const decision = { kind: 'enter', messages: [] }
  const applied = await svc.preStepHandler({ agent: fx.agent }, async () => decision)
  assert.equal(applied, decision)
  assert.equal(fx.current, 'code')
  assert.deepEqual(fx.recomposed, ['code'])
  assert.deepEqual(fx.appended, [['agent-preset/selected', { agentPreset: 'code' }]])
  assert.deepEqual(fx.events[1], ['mode-switcher/switched', 's1', 'code'])
})

test('same-target request is a no-op at pre-step', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  fx.current = 'code'
  await svc.request('s1', 'code')
  await svc.preStepHandler({ agent: fx.agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.deepEqual(fx.recomposed, [])
  assert.deepEqual(fx.appended, [])
})

test('recompose failure keeps session unchanged and emits failure', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  fx.ctx.get = (key) => key === 'agentPresets' ? {
    async resolve(id) { return { id } },
    async recompose() { throw new Error('boom') },
    composedPreset() { return 'standard' },
  } : undefined
  await svc.request('s1', 'code')
  await svc.preStepHandler({ agent: fx.agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(fx.current, 'standard')
  assert.deepEqual(fx.appended, [])
  assert.equal(fx.events[1][0], 'mode-switcher/switch-failed')
})

test('subagent-owned identity is rejected', async () => {
  const fx = makeFixture()
  const child = {
    id: 'child',
    ctx: {},
    session: { header: { origin: 'subagent', parentSession: 's1' }, append: () => {} },
  }
  fx.ctx.agents.get = (id) => (id === 'child' ? child : id === 's1' ? fx.agent : undefined)
  fx.ctx.agents.isOwnedBy = () => true
  const svc = new ModeSwitcherService(fx.ctx)
  const outcome = await svc.request('child', 'code')
  assert.equal(outcome.accepted, false)
  assert.match(outcome.reason, /subagent/)
})

test('whenApplied resolves after pre-step applies the switch', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  await svc.request('s1', 'code')
  const waiter = svc.whenApplied('s1')
  await svc.preStepHandler({ agent: fx.agent }, async () => ({ kind: 'enter', messages: [] }))
  const result = await waiter
  assert.equal(result, 'code')
})

test('serialize chains two switches', async () => {
  const fx = makeFixture()
  const svc = new ModeSwitcherService(fx.ctx)
  const decision = { kind: 'enter', messages: [] }
  // Two armed targets: the chain serializes recompose per session.
  await svc.request('s1', 'minimal')
  await svc.request('s1', 'code')
  await svc.preStepHandler({ agent: fx.agent }, async () => decision)
  await svc.request('s1', 'standard')
  await svc.preStepHandler({ agent: fx.agent }, async () => decision)
  assert.equal(fx.current, 'standard')
  assert.deepEqual(fx.recomposed, ['code', 'standard'])
})
