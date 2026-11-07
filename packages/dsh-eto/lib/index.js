/**
 * dsh-eto — host half.
 *
 * ETO is a Python multi-agent orchestration library (consensus, routing, shared
 * memory, HITL gates, file locks). This plugin mounts it in DeepSeek Harness
 * three ways:
 *
 * - **Tools** — fourteen `ctx.tools.register()` definitions, no `mcp__` prefix
 *   and no MCP process: one short-lived `<python> lib/eto_runner.py <tool>` per
 *   call (see spawn.js).
 * - **Routes** — `GET /@dsh-eto/api/status` and `POST /@dsh-eto/api/test` for the
 *   sidebar panels. They answer with ETO's own facts (version, commit, per-tool
 *   availability, last consensus, routing stats) and never with a local absolute
 *   path: the page shows `~`-relative paths only.
 * - **Settings** — the volatile Config fields below are editable from the
 *   settings page (`settings.section`, id `eto`), which writes through the
 *   client's configuration forms.
 *
 * Failure policy: a broken ETO must not take the session down. Tool calls throw
 * locatable errors, the routes report the problem as data, and the plugin still
 * loads.
 */
import { existsSync } from 'node:fs'
import { Config, resolveSettings, settingsView } from './config.js'
import { listReviews, readReview } from './reviews.js'
import { runTool } from './spawn.js'
import { TOOL_NAMES, createTools, scorePeerText, callLlmRaw } from './tools.js'

/** Peers a panel review asks, in the order ETO itself uses for T1. */
const REVIEW_PEERS = ['researcher', 'coder', 'auditor']
/** A finished job is kept this long so a late poll still finds it. */
const REVIEW_TTL_MS = 10 * 60_000
/** Live review jobs, keyed by id. Process-scoped: a panel reload rejoins by id, a host restart drops them. */
const reviewJobs = new Map()

/**
 * Start one review in the background and return its handle immediately.
 *
 * Each peer is asked independently and its state is published as soon as it settles, so the panel
 * can show "2/3 done, 12s" — a real count of peers that answered, never a fabricated stage.
 * Cancellation aborts every in-flight model call.
 */
function startReviewJob({ ctx, provider, model, plan, peers }) {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const controller = new AbortController()
  const job = {
    id,
    startedAt: Date.now(),
    done: false,
    cancelled: false,
    error: null,
    peers: peers.map(peer => ({ peer, state: 'pending', text: null, error: null })),
    cancel: () => { controller.abort(); job.cancelled = true; job.done = true },
  }
  reviewJobs.set(id, job)
  const sweep = setTimeout(() => reviewJobs.delete(id), REVIEW_TTL_MS)
  sweep.unref?.()

  Promise.all(job.peers.map(async slot => {
    try {
      const text = await scorePeerText({ ctx, provider, model, peer: slot.peer, plan, signal: controller.signal })
      slot.state = 'ok'
      slot.text = text
    } catch (error) {
      slot.state = controller.signal.aborted ? 'cancelled' : 'failed'
      slot.error = error instanceof Error ? error.message : String(error)
    }
  })).then(() => { job.done = true }).catch(error => {
    job.error = error instanceof Error ? error.message : String(error)
    job.done = true
  })
  return job
}

export const name = 'dsh-eto'
/** `tools` is required: registration is the point of the plugin. */
export const inject = ['tools']
export { Config }

/** Route prefix for both endpoints. */
const API = '/@dsh-eto/api'
/** Header a cross-site page cannot set without a CORS preflight. */
const HEADER = 'x-dsh-eto'
/** How long a status probe is cached; opening the panel twice must not spawn twice. */
export const STATUS_TTL_MS = 5_000

const json = (res, code, value) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

const isLoopback = host => host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]')

/**
 * Management requests only: the custom header defeats cross-site requests, and
 * a non-loopback Host must be same-origin (the LAN/remote Web UI case).
 */
function localOnly(req) {
  if (req.headers[HEADER] !== '1') return false
  const host = String(req.headers.host ?? '')
  if (isLoopback(host)) return true
  const origin = String(req.headers.origin ?? '')
  if (!origin) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read a JSON request body, or undefined when it is empty/invalid. */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * One status payload: ETO's self-report plus the plugin's own view of the
 * configuration. `ok` is false when ETO cannot answer at all, and `problems`
 * names every missing piece so the page can tell the user what to fix.
 */
function statusPayload(settings, now = Date.now(), extraTools = {}) {
  const problems = []
  if (!existsSync(settings.repo)) problems.push({ kind: 'repo', message: `ETO checkout not found: ${settingsView(settings).repo}` })
  if (!existsSync(settings.python)) problems.push({ kind: 'python', message: `interpreter not found: ${settingsView(settings).python}` })
  return {
    at: new Date(now).toISOString(),
    settings: settingsView(settings),
    tools: TOOL_NAMES,
    // Tools this plugin provides itself, so the panel can report them without
    // asking ETO about a name ETO has never heard of.
    pluginTools: extraTools,
    problems,
  }
}

/**
 * Probe ETO for its own facts by running the host-only `eto_status` tool.
 * Cached briefly: the page polls, and each miss costs a Python start.
 */
export function createStatusProbe(settingsRef, { now = Date.now, pluginTools = () => ({}), registered = () => [] } = {}) {
  let cached = null
  return async ({ fresh = false } = {}) => {
    if (!fresh && cached !== null && now() - cached.at < STATUS_TTL_MS) return cached.value
    const settings = settingsRef()
    const base = statusPayload(settings, now(), pluginTools())
    base.registered = registered()
    if (base.problems.length > 0) {
      const value = { ...base, ok: false, eto: null, error: base.problems.map(problem => problem.message).join('\n') }
      cached = { at: now(), value }
      return value
    }
    const result = await runTool({ settings, tool: 'eto_status', args: {}, timeoutMs: 20_000 })
    const value = result.ok
      ? { ...base, ok: true, eto: result.value, error: null }
      : {
        ...base,
        ok: false,
        eto: null,
        error: `${result.error?.type ?? 'tool'}: ${result.error?.message ?? 'ETO status probe failed'}`,
      }
    cached = { at: now(), value }
    return value
  }
}

/**
 * Register one route through an effect on the webServer's own sub-fiber.
 * The service is read from `webCtx` (the injected child), never from the plugin
 * context: `ctx.inject` hands back a context where the dependency is present.
 */
function registerRoute(webCtx, route, owner) {
  webCtx.effect(() => {
    const dispose = webCtx.webServer.register(route)
    return () => {
      try {
        dispose()
      } catch {
        // already gone (hot reload replaced the table)
      }
    }
  }, owner)
}

/**
 * Plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} entryConfig - Loader-parsed config (fields may be volatile refs).
 */
export function apply(ctx, entryConfig) {
  const settingsRef = () => resolveSettings(entryConfig)
  /** Tools currently registered on this plugin's fiber, name -> disposer. */
  const live = new Map()
  // `eto_peer_score` is this plugin's own tool: it is available exactly when the
  // host composed an llm service, which is a fact only the host half knows.
  const pluginTools = () => ({
    eto_peer_score: ctx.get('llm') !== undefined
      ? { available: true }
      : { available: false, reason: 'the llm service is not composed in this host' },
  })
  // Live registration names, filled by `syncTools` below; the panel reports these
  // so "configured" and "actually registered" cannot silently diverge.
  const registered = () => [...live.keys()]
  const probe = createStatusProbe(settingsRef, { pluginTools, registered })

  // Tools ride the plugin fiber: dispose unregisters every one of them.
  //
  // The whitelist is a volatile field, so a settings-page save commits into the
  // running config without remounting the plugin. Registration therefore has to
  // be reconciled in place: `syncTools` adds and removes only the difference, so
  // a save takes effect on the next model request instead of on the next restart.
  const { tools: definitions, dsh: dshEndpointApi } = createTools({ ctx, settings: settingsRef })
  const syncTools = () => {
    const enabled = settingsRef().enabledTools
    const unknown = enabled.filter(name => !TOOL_NAMES.includes(name))
    if (unknown.length > 0) ctx.logger?.warn?.(`dsh-eto: enabledTools names unknown tools: ${unknown.join(', ')}`)
    const wanted = enabled.length === 0 ? definitions : definitions.filter(definition => enabled.includes(definition.name))
    const wantedNames = new Set(wanted.map(definition => definition.name))
    for (const [name, dispose] of [...live]) {
      if (wantedNames.has(name)) continue
      live.delete(name)
      dispose()
    }
    for (const definition of wanted) {
      if (live.has(definition.name)) continue
      try {
        live.set(definition.name, ctx.tools.register(definition))
      } catch (error) {
        // A foreign registration squatting on the name must not abort the rest.
        ctx.logger?.warn?.(`dsh-eto: could not register ${definition.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (enabled.length > 0) ctx.logger?.info?.(`dsh-eto: ${live.size}/${definitions.length} tools enabled by config`)
  }

  ctx.effect(() => {
    syncTools()
    return () => {
      for (const dispose of live.values()) dispose()
      live.clear()
    }
  }, 'dsh-eto: tools')
  // A settings-page save arrives here; ordinary (non-volatile) config changes
  // remount the plugin instead, which runs the effect above from scratch.
  ctx.on('loader/volatile-update', () => {
    try {
      syncTools()
    } catch (error) {
      ctx.logger?.warn?.(`dsh-eto: tool re-registration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Routes ride an optional webServer sub-fiber: a headless host composes no web
  // server and keeps the tools alone.
  ctx.inject(['webServer'], webCtx => {
    // The web server's port is OS-assigned, so runners learn it through the environment:
    // ETO consensus peers vote through the host's LLM service as a virtual provider.
    try {
      const port = webCtx.webServer.port
      if (port) dshEndpointApi.setDshEndpoint(`http://127.0.0.1:${port}${API}`)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-eto: could not expose DSH endpoint to runners: ${error instanceof Error ? error.message : String(error)}`)
    }
    registerRoute(webCtx, {
      kind: 'prefix',
      path: API,
      handler: async (req, res) => {
        try {
          if (!localOnly(req)) {
            json(res, 403, { error: `local requests only; missing ${HEADER}: 1 header` })
            return
          }
          const url = new URL(String(req.url ?? '/'), 'http://localhost')
          const sub = url.pathname.startsWith(API) ? url.pathname.slice(API.length) || '/' : url.pathname
          if (sub === '/status' && req.method === 'GET') {
            const payload = await probe({ fresh: url.searchParams.get('fresh') === '1' })
            payload.build = 'workbench-v1'   // probe: which build is the host actually running?
            json(res, 200, payload)
            return
          }
          if (sub === '/test' && req.method === 'POST') {
            const settings = settingsRef()
            const started = Date.now()
            const result = await runTool({ settings, tool: 'eto_status', args: {}, timeoutMs: 20_000 })
            json(res, 200, {
              ok: result.ok,
              latencyMs: Date.now() - started,
              // The test button is the one place a concrete path helps: it is the
              // path the user just typed, echoed back with what was found there.
              repo: settingsView(settings).repo,
              python: settingsView(settings).python,
              repoExists: existsSync(settings.repo),
              pythonExists: existsSync(settings.python),
              tools: result.ok ? Object.keys(result.value?.tools ?? {}) : [],
              error: result.ok ? null : `${result.error?.type ?? 'tool'}: ${result.error?.message ?? 'unknown'}`,
            })
            return
          }
          // Workbench: run a whitelisted read/eval tool from the panel. The
          // whitelist is deliberate — write-heavy or session-bound tools
          // (agent_execute, eto_peer_score) stay model-facing only.
          // Panel-side peer scoring. The panel has no `exec.agent`, so the route can only come
          // from Settings (peerScoreProvider/Model) — that is the documented requirement for
          // consensus-from-panel. Returns the model's raw reply so ETO's own parser runs.
          // Async consensus: POST starts a job, GET /review/<id> polls it. The panel cannot hold a
          // request open for a minute with no feedback, and a killed HTTP request used to lose the
          // whole review. Jobs are in-memory (process-scoped) and pruned after REVIEW_TTL_MS.
          if (sub === '/review' && req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            let body = {}
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* handled below */ }
            const plan = typeof body.plan === 'string' ? body.plan.trim() : ''
            if (plan === '') { json(res, 400, { _error: true, error: 'review needs a non-empty plan' }); return }
            const settings = settingsRef()
            const provider = String(settings.peerScoreProvider || '').trim()
            const model = String(settings.peerScoreModel || '').trim()
            if (provider === '' || model === '') {
              json(res, 409, { _error: true, error: 'panel scoring needs peerScoreProvider and peerScoreModel in the ETO settings page' })
              return
            }
            const job = startReviewJob({ ctx, provider, model, plan, peers: REVIEW_PEERS })
            json(res, 202, { id: job.id, peers: REVIEW_PEERS, startedAt: job.startedAt })
            return
          }
          if (sub.startsWith('/review/') && req.method === 'GET') {
            const job = reviewJobs.get(sub.slice('/review/'.length))
            if (job === undefined) { json(res, 404, { _error: true, error: 'unknown or expired review job' }); return }
            json(res, 200, {
              id: job.id,
              elapsedMs: Date.now() - job.startedAt,
              done: job.done,
              cancelled: job.cancelled,
              peers: job.peers.map(p => ({ peer: p.peer, state: p.state, text: p.text ?? null, error: p.error ?? null })),
              error: job.error ?? null,
            })
            return
          }
          if (sub.startsWith('/review/') && req.method === 'DELETE') {
            const job = reviewJobs.get(sub.slice('/review/'.length))
            if (job === undefined) { json(res, 404, { _error: true, error: 'unknown or expired review job' }); return }
            job.cancel?.()
            json(res, 200, { id: job.id, cancelled: true })
            return
          }
          if (sub === '/llm' && req.method === 'POST') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          let body = {}
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* handled below */ }
          const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
          const model = typeof body.model === 'string' ? body.model.trim() : ''
          const prompt = typeof body.prompt === 'string' ? body.prompt : ''
          if (provider === '' || model === '' || prompt.trim() === '') {
            json(res, 400, { _error: true, error: 'llm needs non-empty provider, model and prompt' })
            return
          }
          try {
            const text = await callLlmRaw({ ctx, provider, model,
              system: typeof body.system === 'string' ? body.system : '',
              prompt, maxTokens: Number(body.maxTokens) || 1024,
              timeoutMs: Number(body.timeoutMs) || 120_000 })
            json(res, 200, { _text: text, provider, model })
          } catch (error) {
            json(res, 502, { _error: true, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (sub === '/peer-score' && req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            let body = {}
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* handled below */ }
            const plan = typeof body.plan === 'string' ? body.plan.trim() : ''
            const peer = typeof body.peer === 'string' && body.peer.trim() !== '' ? body.peer.trim() : 'coder'
            if (plan === '') { json(res, 400, { _error: true, error: 'peer-score needs a non-empty plan' }); return }
            const settings = settingsRef()
            const provider = String(settings.peerScoreProvider || '').trim()
            const model = String(settings.peerScoreModel || '').trim()
            if (provider === '' || model === '') {
              json(res, 409, {
                _error: true,
                error: 'panel scoring needs peerScoreProvider and peerScoreModel in the ETO settings page '
                  + '(a panel request carries no session route to inherit)',
              })
              return
            }
            try {
              const text = await scorePeerText({ ctx, provider, model, peer, plan, timeoutMs: settings.peerScoreTimeoutMs })
              json(res, 200, { _text: text, provider, model, peer })
            } catch (error) {
              json(res, 502, { _error: true, error: error instanceof Error ? error.message : String(error) })
            }
            return
          }
          if (sub === '/run' && req.method === 'POST') {
            // eto_consensus belongs here: it is the workbench's headline action. It is slow
            // (real LLM calls through ETO's own providers) but it is read-only — it scores a
            // plan and writes peer_score:<peer> memory, never touches the repository.
            const RUNNABLE = new Set(['eto_route', 'eto_clarify', 'eto_consensus', 'eto_memory_list', 'eto_memory_read', 'eto_memory_write', 'eto_peer_config', 'eto_file_status'])
            // webServer hands the raw stream: read it the way dsh-superagent-panel does.
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            let input = {}
            try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* handled below */ }
            const tool = typeof input.tool === 'string' ? input.tool : ''
            if (!RUNNABLE.has(tool)) {
              json(res, 400, { error: `tool "${tool}" is not runnable from the panel; allowed: ${[...RUNNABLE].join(', ')}` })
              return
            }
            const settings = settingsRef()
            const started = Date.now()
            // Consensus makes several real LLM calls; 30 s would cut it off. 180 s matches the
            // tool-call budget the model-facing path already uses.
            const budget = tool === 'eto_consensus' ? 180_000 : 30_000
            const result = await runTool({ settings, tool, args: (input.args && typeof input.args === 'object') ? input.args : {}, timeoutMs: budget, env: dshEndpointApi.consensusEnv() })
            json(res, 200, {
              ok: result.ok,
              value: result.ok ? result.value : undefined,
              error: result.ok ? null : `${result.error?.type ?? 'tool'}: ${result.error?.message ?? 'unknown'}`,
              timedOut: result.timedOut === true,
              latencyMs: Date.now() - started,
            })
            return
          }
          // Review ledger: the panel is read-only, so the host serves the on-disk
          // records `eto_consensus` wrote (see tools.js). List returns newest
          // first; the detail route answers by the record's own ledger id.
          if (sub === '/reviews' && req.method === 'GET') {
            json(res, 200, { reviews: listReviews() })
            return
          }
          if (sub.startsWith('/reviews/') && req.method === 'GET') {
            const record = readReview(sub.slice('/reviews/'.length))
            if (record === null) { json(res, 404, { _error: true, error: 'unknown review' }); return }
            json(res, 200, record)
            return
          }
          json(res, 404, { error: 'unknown route', url: req.url })
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }, 'dsh-eto: management api')
  })
}

export default { name, inject, apply, Config }
