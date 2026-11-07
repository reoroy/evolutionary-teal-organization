/**
 * ETO as a virtual provider: adapter metadata, registration and the stream.
 *
 * The stream test runs against a fake interpreter (the same seam spawn.test.mjs
 * uses) so the full chunk protocol — block-start → text deltas → block-end →
 * usage → finish — and the consensus persistence path are exercised without
 * any real LLM or Ollama.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveSettings } from '../lib/config.js'
import { apply } from '../lib/index.js'
import { ETO_MODEL, ETO_PROVIDER, EtoAdapter, parseDelegateRoute, renderConsensus, capPlan } from '../lib/provider.js'
import { listReviews } from '../lib/reviews.js'
import { childEnv } from '../lib/spawn.js'

const CONSENSUS = {
  status: 'approved',
  final_score: 0.75,
  votes: [
    { peer: 'researcher', provider: 'ollama', model: 'qwen3-8b-arb:latest', score: 0.8, concern: '缺量化指标' },
    { peer: 'coder', provider: 'dsh', model: 'deepseek-official/deepseek-flash', score: 0.7, concern: '技术债' },
    { peer: 'auditor', provider: 'dsh', model: 'qodercn/gfmodel', score: 0.75, concern: '云端/本地一致性' },
  ],
  fusion: {
    sources: [
      { peer: 'researcher', provider: 'ollama', model: 'qwen3-8b-arb:latest' },
      { peer: 'coder', provider: 'dsh', model: 'deepseek-official/deepseek-flash' },
      { peer: 'auditor', provider: 'dsh', model: 'qodercn/gfmodel' },
    ],
    distinct_providers: 3,
    aggregator: 'ollama/qwen3-8b-arb:latest',
  },
  synthesis: '先补回滚方案再合并。',
  deliberation: { rounds: 0, strategies: {} },
  actions: [],
  audit_id: 'v1234567890',
}

const fakeCtx = (services = {}) => {
  const registered = new Map()
  const routes = []
  const logs = []
  const ctx = {
    logger: { info: m => logs.push(['info', String(m)]), warn: m => logs.push(['warn', String(m)]) },
    tools: { register: definition => { registered.set(definition.name, definition); return () => registered.delete(definition.name) } },
    get: name => services[name],
    on() { return () => {} },
    effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    inject(names, fn) {
      const present = names.filter(name => services[name] !== undefined)
      if (present.length === 0) return undefined
      const child = Object.create(ctx)
      for (const name of names) child[name] = services[name]
      return fn(child)
    },
  }
  return { ctx, registered, routes, logs }
}

const webServer = routes => ({ register(route) { routes.push(route); return () => {} } })

/** A settings object whose `python` is a script emitting one consensus result. */
function withFakePython(result) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eto-provider-'))
  const script = join(dir, 'fake-python')
  const sentinel = JSON.stringify({ ok: true, result })
  writeFileSync(script, `#!/usr/bin/env node\nprocess.stdout.write("__ETO_RESULT__" + ${JSON.stringify(sentinel)})\n`, 'utf8')
  chmodSync(script, 0o755)
  return { settings: () => resolveSettings({ repo: dir, python: script }, { home: dir }), dir, script }
}

test('renderConsensus names the three fused sources and the distinct-provider count', () => {
  const text = renderConsensus(CONSENSUS)
  assert.match(text, /3 个不同架构/)
  assert.match(text, /qwen3-8b-arb/)
  assert.match(text, /deepseek-official/)
  assert.match(text, /qodercn\/gfmodel/)
  assert.match(text, /先补回滚方案再合并/)
})

test('the eto adapter advertises exactly one model with honest metadata', async () => {
  const adapter = new EtoAdapter({ settings: () => ({}), ctx: { logger: { warn() {} } }, consensusEnv: () => undefined })
  assert.deepEqual(adapter.providerInfo(ETO_PROVIDER), { id: ETO_PROVIDER, name: 'ETO' })
  const models = await adapter.listModels(ETO_PROVIDER)
  assert.equal(models.length, 1)
  assert.equal(models[0].id, ETO_MODEL)
  assert.equal(models[0].provider, ETO_PROVIDER)
  assert.deepEqual(models[0].inputModalities, ['text'])
  const resolved = await adapter.resolveModel(ETO_PROVIDER, ETO_MODEL)
  assert.equal(resolved.id, ETO_MODEL)
  assert.ok(resolved.context.contextWindow > 0)
  assert.ok(resolved.defaultMaxTokens > 0)
})

test('apply registers the eto provider when the host composes an llm service', () => {
  const routes = []
  const registrations = []
  const llm = { registerAdapter: (providers, adapter) => { registrations.push({ providers, adapter }); return () => {} } }
  const { ctx } = fakeCtx({ webServer: webServer(routes), llm })
  apply(ctx, { repo: '/definitely/not/here' })
  assert.equal(registrations.length, 1)
  assert.deepEqual(registrations[0].providers, [ETO_PROVIDER])
  assert.ok(registrations[0].adapter instanceof EtoAdapter)
})

test('a host without an llm service keeps the tools and registers no provider', () => {
  const routes = []
  const { ctx, registered } = fakeCtx({ webServer: webServer(routes) })
  apply(ctx, { repo: '/definitely/not/here' })
  assert.ok(registered.size > 0, 'tools still register')
})

test('the stream runs one consensus, persists a review, and ends with a stop finish', async () => {
  const { settings, dir } = withFakePython(CONSENSUS)
  const previous = process.env.HOME
  process.env.HOME = dir
  try {
    const adapter = new EtoAdapter({
      settings,
      ctx: { logger: { warn() {} } },
      consensusEnv: () => childEnv(settings(), process.env),
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: ETO_PROVIDER,
      model: ETO_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: '评审这个合并方案' }] }],
    })) chunks.push(chunk)

    assert.equal(chunks[0].type, 'block-start')
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta'))
    const end = chunks.find(chunk => chunk.type === 'block-end')
    assert.ok(end, 'the stream must close the text block')
    assert.match(end.block.text, /3 个不同架构/)
    assert.deepEqual(chunks[chunks.length - 1], { type: 'finish', reason: { kind: 'stop' } })

    const reviews = listReviews(dir)
    assert.equal(reviews.length, 1)
    assert.equal(reviews[0].fusion.distinct_providers, 3)
    assert.equal(reviews[0].plan, '评审这个合并方案')
  } finally {
    process.env.HOME = previous
  }
})

test('parseDelegateRoute splits provider/model and falls back to the default', () => {
  assert.deepEqual(parseDelegateRoute(''), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(parseDelegateRoute('deepseek-official/deepseek-flash'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(parseDelegateRoute('  dsh/qodercn/gfmodel '), { provider: 'dsh', model: 'qodercn/gfmodel' })
  assert.deepEqual(parseDelegateRoute('some-model'), { provider: 'deepseek-official', model: 'some-model' })
})

test('a direct-routed turn delegates to the host model and does not fuse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eto-direct-'))
  const script = join(dir, 'fake-python')
  const route = JSON.stringify({ ok: true, result: { gewu: 'knowledge', route: 'direct', confidence: 0.7 } })
  const fused = JSON.stringify({ ok: true, result: CONSENSUS })
  writeFileSync(script, [
    '#!/usr/bin/env node',
    '// argv: [node, <script>, <RUNNER>, <tool>]',
    'const tool = process.argv[3]',
    `const route = ${JSON.stringify(route)}`,
    `const fused = ${JSON.stringify(fused)}`,
    'process.stdout.write("__ETO_RESULT__" + (tool === "eto_route" ? route : fused))',
  ].join('\n') + '\n', 'utf8')
  chmodSync(script, 0o755)

  const calls = []
  const llm = {
    stream: async function* (options) {
      calls.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '今天是几号' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '今天是几号' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }

  const previous = process.env.HOME
  process.env.HOME = dir
  try {
    const settings = () => resolveSettings({ repo: dir, python: script }, { home: dir })
    const adapter = new EtoAdapter({
      settings,
      ctx: { logger: { warn() {} }, get: name => (name === 'llm' ? llm : undefined) },
      consensusEnv: () => childEnv(settings(), process.env),
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: ETO_PROVIDER,
      model: ETO_MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: '今天几号' }] }],
    })) chunks.push(chunk)

    assert.equal(calls.length, 1, 'a direct turn delegates exactly once')
    assert.equal(calls[0].provider, 'deepseek-official')
    assert.equal(calls[0].model, 'deepseek-flash')
    assert.deepEqual(calls[0].messages[0].content[0].text, '今天几号')
    assert.equal(listReviews(dir).length, 0, 'a direct turn must not persist a review')
    const end = chunks.find(chunk => chunk.type === 'block-end')
    assert.ok(end, 'the delegate must close the text block')
    assert.match(end.block.text, /今天是几号/)
  } finally {
    process.env.HOME = previous
  }
})

test('the adapter advertises the execution model window, not the smallest peer', async () => {
  // ETO is a consultation layer: the session's capacity belongs to the model that executes
  // (delegateModel), so the advertised window must come from resolving that model — pinning it
  // to the smallest consensus peer would cap the whole session at local-qwen size.
  const asked = []
  const llm = {
    resolveModel: async (provider, model) => { asked.push(`${provider}/${model}`); return { context: { contextWindow: 131_072 } } },
  }
  const adapter = new EtoAdapter({
    settings: () => ({ delegateModel: 'deepseek-official/deepseek-flash' }),
    ctx: { get: name => (name === 'llm' ? llm : undefined), logger: { warn() {} } },
    consensusEnv: () => undefined,
  })
  const resolved = await adapter.resolveModel(ETO_PROVIDER, ETO_MODEL)
  assert.deepEqual(asked, ['deepseek-official/deepseek-flash'], 'must resolve the delegate model it actually executes with')
  assert.equal(resolved.context.contextWindow, 131_072, 'advertised window must be the execution model\'s, not a peer-sized cap')
  assert.ok(resolved.defaultMaxTokens <= 2_048, `defaultMaxTokens ${resolved.defaultMaxTokens} must stay a short conclusion budget`)
})

test('a host without a resolvable delegate falls back instead of shrinking the session', async () => {
  const adapter = new EtoAdapter({ settings: () => ({}), ctx: { logger: { warn() {} } }, consensusEnv: () => undefined })
  const resolved = await adapter.resolveModel(ETO_PROVIDER, ETO_MODEL)
  assert.ok(resolved.context.contextWindow >= 32_768, 'fallback must not advertise a peer-sized window')
})

test('ETO caps its own input budget and reports the clip instead of cutting silently', () => {
  // The plan forwarded to the peers is ETO's own concern; the clip is reported, never silent,
  // and it never becomes the session's advertised context window.
  const short = capPlan('x'.repeat(100))
  assert.equal(short.forwarded.length, 100)
  assert.equal(short.notice, '', 'a plan inside the budget must not warn')

  const huge = capPlan('x'.repeat(30_000))
  assert.ok(huge.forwarded.length < 30_000, 'the forwarded plan must be clipped')
  assert.ok(huge.notice.includes('超过 ETO 自管预算'), 'the clip must be reported')
})

test('renderConsensus leads with the answer and omits the full JSON by default', () => {
  const text = renderConsensus(CONSENSUS)
  // The synthesis is the first line, before any scorecard.
  assert.ok(text.indexOf('先补回滚方案再合并') < text.indexOf('结论：'))
  assert.ok(text.indexOf('先补回滚方案再合并') < text.indexOf('分歧与依据'))
  assert.ok(!text.includes('完整结果'), 'no full JSON unless requested')

  const full = renderConsensus(CONSENSUS, { full: true })
  assert.ok(full.includes('完整结果'))
  assert.ok(full.includes('"audit_id"'))
})
