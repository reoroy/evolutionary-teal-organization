/**
 * Plugin wiring: what `apply()` actually does with a cordis-like context.
 *
 * The registry and the web server are doubles, but everything between them is
 * the real code path — including the settings whitelist, the two HTTP routes and
 * the "ETO is missing" diagnosis a user sees in the panel.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS_TTL_MS, apply, createStatusProbe, inject, name } from '../lib/index.js'
import { resolveSettings } from '../lib/config.js'
import { TOOL_NAMES } from '../lib/tools.js'

/**
 * A minimal cordis context: effects run immediately and their disposers are
 * collected, `inject` runs its callback at once, `get` answers from a table.
 */
function fakeCtx(services = {}) {
  const disposers = []
  const registered = new Map()
  const routes = []
  const effects = []
  const logs = []
  const listeners = new Map()
  const ctx = {
    logger: { info: (message) => logs.push(['info', String(message)]), warn: (message) => logs.push(['warn', String(message)]) },
    tools: {
      register(definition) {
        assert.ok(!registered.has(definition.name), `duplicate registration of ${definition.name}`)
        registered.set(definition.name, definition)
        const dispose = () => registered.delete(definition.name)
        disposers.push(dispose)
        return dispose
      },
    },
    get: (serviceName) => services[serviceName],
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
      return () => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== handler))
    },
    emit(event) {
      for (const handler of listeners.get(event) ?? []) handler()
    },
    effect(fn, label) {
      effects.push(label)
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inject(names, fn) {
      // Real cordis hands the callback a context where the injected services are
      // present; mirror that so `webCtx.webServer` is what production sees.
      const values = names.filter(serviceName => services[serviceName] !== undefined)
      if (values.length === 0) return undefined
      const child = Object.create(ctx)
      for (const serviceName of names) child[serviceName] = services[serviceName]
      return fn(child)
    },
  }
  return { ctx, registered, routes, effects, logs, disposers, emit: event => ctx.emit(event) }
}

const webServer = (routes) => ({
  register(route) {
    routes.push(route)
    return () => {
      const index = routes.indexOf(route)
      if (index !== -1) routes.splice(index, 1)
    }
  },
})

/** Call one registered route with a plain request and collect the response. */
async function callRoute(routes, { path, method = 'GET', headers = {}, body }) {
  const route = routes.find(candidate => path.startsWith(candidate.path))
  assert.ok(route, `no route matched ${path}`)
  const chunks = []
  const req = (async function* () {
    if (body !== undefined) yield Buffer.from(body, 'utf8')
  })()
  req.url = path
  req.method = method
  req.headers = { host: '127.0.0.1:3080', 'x-dsh-eto': '1', ...headers }
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    writeHead(code, extra) {
      this.statusCode = code
      this.headers = extra ?? {}
    },
    end(text) {
      this.payload += text ?? ''
    },
  }
  await route.handler(req, res)
  return { status: res.statusCode, headers: res.headers, body: res.payload ? JSON.parse(res.payload) : null }
}

test('declares the tools service it writes into', () => {
  assert.equal(name, 'dsh-eto')
  assert.deepEqual(inject, ['tools'])
})

test('registers every tool on the plugin fiber and removes them on dispose', () => {
  const { ctx, registered, effects, disposers } = fakeCtx()
  apply(ctx, {})
  assert.deepEqual([...registered.keys()].sort(), [...TOOL_NAMES].sort())
  assert.ok(effects.includes('dsh-eto: tools'))
  for (const dispose of disposers) dispose()
  assert.equal(registered.size, 0, 'disposing the fiber must unregister every tool')
})

test('enabledTools limits registration to the named tools', () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { enabledTools: ['eto_route', 'eto_peer_score'] })
  assert.deepEqual([...registered.keys()].sort(), ['eto_peer_score', 'eto_route'])
})

test('an unknown enabledTools name is logged, not silently ignored', () => {
  const { ctx, logs } = fakeCtx()
  apply(ctx, { enabledTools: ['eto_route', 'eto_nope'] })
  assert.ok(logs.some(([level, message]) => level === 'warn' && message.includes('eto_nope')), JSON.stringify(logs))
})

test('a settings save re-registers tools in place, without a remount', () => {
  // The whitelist is volatile: the Loader commits the new value into the running
  // references and emits `loader/volatile-update`. Registration must reconcile
  // then, or the save silently waits for a restart.
  const entryConfig = { enabledTools: [] }
  const { ctx, registered, emit, disposers } = fakeCtx()
  apply(ctx, entryConfig)
  assert.equal(registered.size, TOOL_NAMES.length)

  entryConfig.enabledTools = ['eto_route', 'eto_peer_score']
  emit('loader/volatile-update')
  assert.deepEqual([...registered.keys()].sort(), ['eto_peer_score', 'eto_route'])

  entryConfig.enabledTools = []
  emit('loader/volatile-update')
  assert.equal(registered.size, TOOL_NAMES.length)

  for (const dispose of disposers) dispose()
  assert.equal(registered.size, 0)
})

test('a foreign registration on a tool name does not abort the others', () => {
  const { ctx, registered } = fakeCtx()
  const realRegister = ctx.tools.register.bind(ctx.tools)
  ctx.tools.register = (definition) => {
    if (definition.name === 'eto_route') throw new Error('duplicate tool name')
    return realRegister(definition)
  }
  apply(ctx, {})
  assert.ok(!registered.has('eto_route'))
  assert.equal(registered.size, TOOL_NAMES.length - 1)
})

test('a headless host (no webServer) still registers the tools', () => {
  const { ctx, registered, routes } = fakeCtx()
  apply(ctx, {})
  assert.equal(registered.size, TOOL_NAMES.length)
  assert.equal(routes.length, 0)
})

test('GET status reports the missing checkout with a ~-relative path', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, { repo: '/definitely/not/here' })
  const { status, body } = await callRoute(routes, { path: '/@dsh-eto/api/status' })
  assert.equal(status, 200)
  assert.equal(body.ok, false)
  assert.match(body.error, /ETO checkout not found/)
  assert.ok(body.problems.some(problem => problem.kind === 'repo'))
  assert.equal(body.settings.repo, '/definitely/not/here')
  assert.equal(body.tools.length, TOOL_NAMES.length)
})

test('the status payload reports this plugin\'s own tool separately from ETO\'s', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, { repo: '/definitely/not/here' })
  const { body } = await callRoute(routes, { path: '/@dsh-eto/api/status' })
  assert.ok(body.pluginTools, 'the payload must carry the plugin-owned tool status')
  assert.equal(body.pluginTools.eto_peer_score.available, false, 'no llm service in this host')
  assert.match(body.pluginTools.eto_peer_score.reason, /llm service/)

  const withLlm = []
  const second = fakeCtx({ webServer: webServer(withLlm), llm: { stream: () => {} } })
  apply(second.ctx, { repo: '/definitely/not/here' })
  const withLlmBody = (await callRoute(withLlm, { path: '/@dsh-eto/api/status' })).body
  assert.equal(withLlmBody.pluginTools.eto_peer_score.available, true)
})

test('the status route refuses a cross-site request', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, {})
  const noHeader = await callRoute(routes, { path: '/@dsh-eto/api/status', headers: { 'x-dsh-eto': '0' } })
  assert.equal(noHeader.status, 403)
  const crossSite = await callRoute(routes, {
    path: '/@dsh-eto/api/status',
    headers: { host: '10.0.0.5:3080', origin: 'https://evil.example' },
  })
  assert.equal(crossSite.status, 403)
})

test('the test route reports latency and what exists on disk', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, { repo: '/definitely/not/here', python: '/definitely/not/here/python' })
  const { status, body } = await callRoute(routes, { path: '/@dsh-eto/api/test', method: 'POST', body: '{}' })
  assert.equal(status, 200)
  assert.equal(body.ok, false)
  assert.equal(body.repoExists, false)
  assert.equal(body.pythonExists, false)
  assert.equal(typeof body.latencyMs, 'number')
  assert.match(body.error, /interpreter not found/)
})

test('an unknown sub-route is a 404 with the path in the answer', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, {})
  const { status, body } = await callRoute(routes, { path: '/@dsh-eto/api/nope' })
  assert.equal(status, 404)
  assert.match(body.error, /unknown route/)
})

test('the status probe caches between polls and ?fresh=1 bypasses the cache', async () => {
  const routes = []
  const { ctx } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, { repo: process.cwd(), python: '/definitely/not/here/python' })
  const first = await callRoute(routes, { path: '/@dsh-eto/api/status' })
  const second = await callRoute(routes, { path: '/@dsh-eto/api/status' })
  assert.equal(second.body.at, first.body.at, 'a poll inside the TTL must reuse the cached payload')
  const fresh = await callRoute(routes, { path: '/@dsh-eto/api/status?fresh=1' })
  assert.deepEqual(fresh.body.problems, first.body.problems, 'a bypass still describes the same ETO')
})

test('the probe answers from cache inside the TTL and probes again after it', async () => {
  // A controlled clock makes the TTL observable: the `at` stamp moves only when
  // the probe really ran again.
  let clock = 1_000_000
  const now = () => clock
  const probe = createStatusProbe(() => resolveSettings({ repo: '/definitely/not/here' }, { home: '/h' }), { now })
  const first = await probe()
  clock += 1_000
  const cached = await probe()
  assert.equal(cached, first, 'inside the TTL the same payload object comes back')
  clock += STATUS_TTL_MS + 1
  const again = await probe()
  assert.notEqual(again, first, 'after the TTL the probe runs again')
  assert.notEqual(again.at, first.at)
  const bypass = await probe({ fresh: true })
  assert.notEqual(bypass, again, '?fresh=1 skips the cache')
})
