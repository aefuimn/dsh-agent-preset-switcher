/**
 * dsh-mode-switcher core: hot-switch a session's agent preset at the next
 * step boundary.
 *
 * The official `agentPresets.select` refuses to swap a session that already
 * started (the `sessionBlank` gate). This service reuses the SAME official
 * mechanism for every stage: `AgentPresets.recompose(agent.ctx, id)` —
 * standing preset mounts + the roster-held scope-parent binding re-link —
 * but arms the request and only applies it inside the `agent/pre-step`
 * waterfall, i.e. between model requests. The new tool catalog and prompt
 * sections therefore take effect only for the request assembled after the
 * boundary, and `agent-preset/selected` is logged exactly like the official
 * channel, so resume/fork rebuild the same composition and the browser's
 * `agent-preset/selected` listeners refresh.
 */
/**
 * The host service. Registered per plugin instance on the HOST plane; every
 * API layer (the /mode command, future RPC/CLI, other plugins) goes
 * through `ctx.modeSwitcher.request`.
 */
export class ModeSwitcherService {
    ctx;
    /** Armed switches per session id; latest wins on apply. */
    armed = new Map();
    /** Rolling waiters per session: one per switch request that needs to report. */
    waiters = new Map();
    /** Serialization chain per session (same shape as the host's presetSwitches). */
    chains = new Map();
    /** True once the pre-step hook is installed (idempotent apply). */
    hookInstalled = false;
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** Install the step-boundary hook (idempotent). Called from plugin apply. */
    install() {
        if (this.hookInstalled)
            return;
        this.hookInstalled = true;
        this.ctx.on('agent/pre-step', (payload, next) => this.applyAtStepBoundary(payload.agent, next));
    }
    /** Test seam: the exact pre-step listener install() registered. */
    preStepHandler(payload, next) {
        return this.applyAtStepBoundary(payload.agent, next);
    }
    /**
     * The preset one live agent currently runs on, read from the live scope
     * chain (which is what recompose re-links).
     */
    currentPresetId(agent) {
        return this.ctx.get('agentPresets')?.composedPreset?.(agent.ctx);
    }
    /** The per-session armed target (tests/diagnostics). */
    armedFor(sessionId) {
        return this.armed.get(sessionId)?.presetId;
    }
    /**
     * Arm a switch for one session. The actual composition swap happens at the
     * next `agent/pre-step`; until then the session keeps its current tools.
     *
     * Accepts immediately even while the agent is running — the swap lands at
     * the next step boundary. Rejects only when the session cannot be found,
     * is a subagent-owned identity (host rule), or the target preset is not on
     * the roster.
     *
     * @param sessionId - live session identity.
     * @param presetId - target agent-preset id.
     */
    async request(sessionId, presetId) {
        const agent = this.ctx.agents?.get(sessionId);
        if (agent === undefined) {
            return { accepted: false, reason: `session "${sessionId}" is not live` };
        }
        // Subagent-owned identities keep the host's ownership fence.
        if (agent.session.header.origin === 'subagent' || agent.session.header.parentSession !== undefined) {
            const agents = this.ctx.agents;
            const parent = agent.session.header.parentSession;
            if (agents !== undefined && parent !== undefined) {
                const parentAgent = agents.get(parent);
                if (parentAgent !== undefined && agents.isOwnedBy(agent.id, parentAgent)) {
                    return { accepted: false, reason: 'subagent sessions keep their parent preset' };
                }
            }
        }
        const presets = this.ctx.get('agentPresets');
        if (presets === undefined) {
            return { accepted: false, reason: 'this deployment composes no agent presets' };
        }
        // Validate the preset resolves NOW so a typo fails fast instead of
        // silently at the boundary (the boundary re-validates through recompose).
        try {
            await presets.resolve(presetId);
        }
        catch {
            return { accepted: false, reason: `unknown agent preset "${presetId}"` };
        }
        this.armed.set(sessionId, { presetId, at: Date.now() });
        this.ctx.emit('mode-switcher/requested', sessionId, presetId);
        return { accepted: true, pending: true };
    }
    /** Return once the armed switch has been applied (or a newer one replaced it). */
    async whenApplied(sessionId) {
        if (!this.armed.has(sessionId))
            return undefined;
        return new Promise((resolve) => {
            const set = this.waiters.get(sessionId) ?? new Set();
            set.add(resolve);
            this.waiters.set(sessionId, set);
        });
    }
    /**
     * The pre-step waterfall. Pop the armed target (latest wins), apply it, then
     * delegate to the default (returning `undefined` keeps the current
     * messages). Failure => no swap, session unchanged, failure event; the
     * step proceeds normally with the old composition.
     */
    async applyAtStepBoundary(agent, next) {
        const armed = this.armed.get(agent.id);
        if (armed !== undefined) {
            this.armed.delete(agent.id);
            const current = this.currentPresetId(agent);
            if (current === armed.presetId) {
                // Idempotent: no-op, no log event, release any waiter.
                this.settle(agent.id, armed.presetId);
                return next();
            }
            try {
                await this.serialize(agent.id, () => this.applySwitch(agent, armed.presetId));
                this.settle(agent.id, armed.presetId);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.ctx.emit('mode-switcher/switch-failed', agent.id, armed.presetId, message);
            }
        }
        return next();
    }
    /**
     * The actual swap + log + notify, serialized per session.
     *
     * `recompose` is the official re-link path: it ensures (single-flight) the
     * target's standing mount, then moves THIS agent's scope-parent binding to
     * it. We log `agent-preset/selected` only AFTER the re-link succeeded, so
     * a failed recompose never pretends the session runs a preset it does not.
     */
    async applySwitch(agent, presetId) {
        const presets = this.ctx.get('agentPresets');
        if (presets === undefined)
            throw new Error('this deployment composes no agent presets');
        const preset = await presets.recompose(agent.ctx, presetId);
        agent.session.append('agent-preset/selected', { agentPreset: preset.id });
        this.ctx.emit('mode-switcher/switched', agent.id, preset.id);
    }
    /** Release this session's waiters (idempotent). */
    settle(sessionId, presetId) {
        const waiters = this.waiters.get(sessionId);
        if (waiters === undefined)
            return;
        this.waiters.delete(sessionId);
        for (const resolve of waiters)
            resolve(presetId);
    }
    /** Serialize one switch per session. */
    async serialize(sessionId, work) {
        const previous = this.chains.get(sessionId) ?? Promise.resolve();
        const next = previous.then(work, work);
        this.chains.set(sessionId, next.then(() => undefined, () => undefined));
        try {
            return await next;
        }
        finally {
            if (this.chains.get(sessionId) === next.then(() => undefined, () => undefined)) {
                this.chains.delete(sessionId);
            }
        }
    }
}
