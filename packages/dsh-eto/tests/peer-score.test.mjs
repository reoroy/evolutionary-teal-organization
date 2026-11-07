/**
 * `eto_peer_score`: the tool that runs ETO's peer review on the *session's* model.
 *
 * A stub `llm` service stands in for the provider, so these tests pin the parts
 * that are this plugin's responsibility: which route is chosen, that a failure
 * is reported instead of a made-up score, that the canonical value is bounded,
 * and that the result reaches ETO's shared memory under `peer_score:<peer>`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTools } from '../lib/tools.js'
import { resolveSettings } from '../lib/config.js'

/** A fake llm service that streams one text reply, or one failure finish. */
function fakeLlm({ reply = '', finish, onCall } = {}) {
  return {
    stream(options) {
      onCall?.(options)
      return (async function* () {
        if (finish !== undefined) {
          yield { type: 'finish', reason: finish }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/** A context double: `llm`, `logger`, and a recording `get`. */
function ctxWith(llm) {
  const warnings = []
  return {
    ctx: {
      get: (name) => (name === 'llm' ? llm : undefined),
      logger: { warn: (message) => warnings.push(String(message)), info: () => {} },
    },
    warnings,
  }
}

const agentOn = (provider, model) => ({
  session: { requestHeader: () => ({ config: { provider, model } }) },
})

const settings = (overrides = {}) => resolveSettings(overrides, { home: '/h' })

/** `createTools` takes a resolver; these tests pass one resolved snapshot. */
const scoreTool = (ctx, resolved) => createTools({ ctx, settings: () => resolved }).tools.find(tool => tool.name === 'eto_peer_score')

/** Run the score tool; a write-back spawn is expected to fail under this fake HOME. */
const run = (tool, args, exec = {}) => tool.execute(args, {
  signal: new AbortController().signal,
  agent: exec.agent,
})

test('scores with the session model and reports the route it used', async () => {
  let seen = null
  const { ctx } = ctxWith(fakeLlm({
    reply: '```json\n{"score": 0.72, "concern": "缺少回滚", "suggestion": "加回滚步骤"}\n```',
    onCall: (options) => { seen = options },
  }))
  const tool = scoreTool(ctx, settings())
  const value = await run(tool, { plan: '重构路由层' }, { agent: agentOn('workbuddy', 'deepseek-v4.1-flash') })

  assert.equal(seen.provider, 'workbuddy')
  assert.equal(seen.model, 'deepseek-v4.1-flash')
  assert.match(seen.system, /编码员/)
  assert.match(seen.messages[0].content[0].text, /重构路由层/)
  assert.equal(value.peer, 'coder')
  assert.equal(value.provider, 'workbuddy')
  assert.equal(value.model, 'deepseek-v4.1-flash')
  assert.equal(value.routeSource, 'session')
  assert.equal(value.score, 0.72)
  assert.equal(value.concern, '缺少回滚')
  assert.equal(value.suggestion, '加回滚步骤')
  assert.equal(typeof value.latencyMs, 'number')
})

test('an explicit provider/model pair overrides the session route', async () => {
  let seen = null
  const { ctx } = ctxWith(fakeLlm({ reply: '{"score":0.4}', onCall: (options) => { seen = options } }))
  const tool = scoreTool(ctx, settings({ peerScoreProvider: 'deepseek', peerScoreModel: 'deepseek-v4' }))
  const value = await run(tool, { plan: 'x', peer: 'auditor' }, { agent: agentOn('workbuddy', 'other') })
  assert.equal(seen.provider, 'deepseek')
  assert.equal(seen.model, 'deepseek-v4')
  assert.equal(value.routeSource, 'settings')
  assert.equal(value.peer, 'auditor')
  assert.match(seen.system, /审计员/)
})

test('scores are clamped into 0..1', async () => {
  const { ctx } = ctxWith(fakeLlm({ reply: '{"score": 7}' }))
  const value = await run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') })
  assert.equal(value.score, 1)

  const low = ctxWith(fakeLlm({ reply: '{"score": -3}' }))
  const value2 = await run(scoreTool(low.ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') })
  assert.equal(value2.score, 0)
})

test('an unparseable reply is an error, never a default score', async () => {
  const { ctx } = ctxWith(fakeLlm({ reply: '我认为这个计划还行。' }))
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') }),
    /contained no JSON object/,
  )
})

test('a numeric field that is not a number is an error', async () => {
  const { ctx } = ctxWith(fakeLlm({ reply: '{"score": "high"}' }))
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') }),
    /no numeric "score"/,
  )
})

test('a provider failure surfaces with its code and message', async () => {
  const { ctx } = ctxWith(fakeLlm({ finish: { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } }))
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') }),
    /model call failed \(AUTH\): bad key/,
  )
})

test('no resolvable route is reported, not silently defaulted', async () => {
  const { ctx } = ctxWith(fakeLlm({ reply: '{"score":0.5}' }))
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: { session: { requestHeader: () => undefined } } }),
    /no model route could be resolved/,
  )
})

test('a host without the llm service refuses instead of faking a score', async () => {
  const { ctx } = ctxWith(undefined)
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: 'x' }, { agent: agentOn('p', 'm') }),
    /llm service is not composed/,
  )
})

test('an empty plan is refused', async () => {
  const { ctx } = ctxWith(fakeLlm({ reply: '{"score":0.5}' }))
  await assert.rejects(
    () => run(scoreTool(ctx, settings()), { plan: '   ' }, { agent: agentOn('p', 'm') }),
    /缺少必填参数 plan/,
  )
})

test('the write-back target is peer_score:<peer>', async () => {
  // The write-back goes through the runner; a missing interpreter makes it fail
  // without touching the real shared memory, and `stored` must say so.
  const { ctx, warnings } = ctxWith(fakeLlm({ reply: '{"score":0.9}' }))
  const tool = scoreTool(ctx, resolveSettings({ python: '/nonexistent/python' }, { home: '/h' }))
  const value = await run(tool, { plan: 'x', peer: 'researcher' }, { agent: agentOn('p', 'm') })
  assert.equal(value.score, 0.9)
  assert.equal(value.stored, false, 'a failed write-back must not claim storage')
  assert.ok(warnings.some(message => /could not store researcher/.test(message)), warnings.join('\n'))
})
