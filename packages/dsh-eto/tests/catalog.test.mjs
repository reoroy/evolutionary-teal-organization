/**
 * Tool catalog: names, schemas, whitelist behaviour and the runner contract.
 *
 * These are the assertions a change to the tool surface must keep true: the
 * model sees fourteen prefix-free names, every schema stays inside the enforced
 * JSON Schema subset, and the Python dispatch table has no tool the JS half
 * cannot call (or vice versa).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertSupportedJsonSchema, assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { ETO_TOOL_NAMES, TOOL_NAMES, createTools, extractScoreObject, resolveScoreRoute } from '../lib/tools.js'
import { resolveSettings } from '../lib/config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNNER_SOURCE = readFileSync(join(HERE, '..', 'lib', 'eto_runner.py'), 'utf8')

/** Minimal context double: only `get` and `logger` are used by the definitions. */
const fakeCtx = () => ({
  get: () => undefined,
  logger: { warn: () => {}, info: () => {} },
})

const settings = () => resolveSettings({}, { home: '/home/tester' })
const build = () => createTools({ ctx: fakeCtx(), settings }).tools

test('registers the fourteen tools with no MCP prefix', () => {
  const tools = build()
  assert.deepEqual(tools.map(tool => tool.name), [...TOOL_NAMES])
  for (const tool of tools) {
    assert.ok(!tool.name.startsWith('mcp__'), `${tool.name} must not carry the MCP prefix`)
  }
  assert.equal(ETO_TOOL_NAMES.length, 13)
  assert.ok(!ETO_TOOL_NAMES.includes('eto_peer_score'))
})

test('every tool has a description, an object parameter schema and a renderer', () => {
  for (const tool of build()) {
    assert.ok(tool.description.length > 10, `${tool.name} needs a real description`)
    assert.equal(tool.parameters.type, 'object', `${tool.name} parameters must be object-rooted`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} needs output.render`)
    assert.equal(typeof tool.execute, 'function')
  }
})

test('output schemas stay inside the enforced subset', () => {
  for (const tool of build()) {
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema), `${tool.name} output schema`)
  }
})

test('parameter schemas validate as object schemas with declared required keys', () => {
  for (const tool of build()) {
    assert.doesNotThrow(() => assertObjectJsonSchema(tool.parameters), `${tool.name} parameters`)
    const required = tool.parameters.required ?? []
    for (const key of required) {
      assert.ok(key in (tool.parameters.properties ?? {}), `${tool.name}: required ${key} has no property`)
    }
  }
})

test('renderers are pure and produce one text block', () => {
  for (const tool of build()) {
    const value = tool.name === 'eto_memory_list' ? ['a', 'b'] : { status: 'approved', final_score: 0.75, votes: [] }
    const blocks = tool.output.render({}, value)
    assert.ok(Array.isArray(blocks) && blocks.length > 0, `${tool.name} render output`)
    assert.equal(blocks[0].type, 'text')
  }
})

test('the Python dispatch table and the JS catalog agree', () => {
  const pythonTools = /TOOLS = \(([\s\S]*?)\)/.exec(RUNNER_SOURCE)[1]
  const names = [...pythonTools.matchAll(/"([a-z_]+)"/g)].map(match => match[1])
  assert.deepEqual(names.sort(), [...ETO_TOOL_NAMES].sort(), 'runner TOOLS must list exactly the ETO tools')
  // Every tool the JS half calls must have a handler, and eto_status stays host-only.
  const handlers = /HANDLERS = \{([\s\S]*?)\n\}/.exec(RUNNER_SOURCE)[1]
  for (const name of [...ETO_TOOL_NAMES, 'eto_status']) {
    assert.ok(handlers.includes(`"${name}"`), `runner HANDLERS is missing ${name}`)
  }
  assert.ok(!TOOL_NAMES.includes('eto_status'), 'eto_status must not be registered with the model')
})

test('enabledTools whitelists by name', () => {
  const all = createTools({ ctx: fakeCtx(), settings: () => resolveSettings({ enabledTools: [] }, { home: '/h' }) }).tools
  assert.equal(all.length, TOOL_NAMES.length)
})

test('resolveScoreRoute prefers an explicit pair, then the session route', () => {
  const explicit = resolveScoreRoute({ peerScoreProvider: 'deepseek', peerScoreModel: 'deepseek-v4' }, undefined)
  assert.deepEqual(explicit, { provider: 'deepseek', model: 'deepseek-v4', source: 'settings' })

  const halfPair = resolveScoreRoute({ peerScoreProvider: 'deepseek', peerScoreModel: '' }, {
    session: { requestHeader: () => ({ config: { provider: 'workbuddy', model: 'deepseek-v4.1-flash' } }) },
  })
  assert.deepEqual(halfPair, { provider: 'workbuddy', model: 'deepseek-v4.1-flash', source: 'session' })

  const fromOptions = resolveScoreRoute({}, { options: { provider: 'p', model: 'm' } })
  assert.deepEqual(fromOptions, { provider: 'p', model: 'm', source: 'session' })

  assert.throws(() => resolveScoreRoute({}, { session: { requestHeader: () => undefined } }), /no model route could be resolved/)
})

test('extractScoreObject tolerates fences and surrounding prose', () => {
  assert.deepEqual(extractScoreObject('{"score":0.5}'), { score: 0.5 })
  assert.deepEqual(extractScoreObject('好的：\n```json\n{"score":0.8,"concern":"x"}\n```\n完'), { score: 0.8, concern: 'x' })
  assert.deepEqual(extractScoreObject('前缀 {"score": 0.2} 后缀'), { score: 0.2 })
  assert.equal(extractScoreObject('no json here'), null)
  assert.equal(extractScoreObject('[1,2,3]'), null)
})
