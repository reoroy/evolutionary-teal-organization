/**
 * Live ETO integration: real Python, real stitches, isolated HOME.
 *
 * These tests are the ones that would have caught the old bridge's failures:
 * they call the runner the way the plugin does, and they assert on ETO's own
 * answers (routing classification, memory round trip, file lock, consensus with
 * a stub provider). `HOME` is redirected into a temp directory so the shared
 * memory and metrics files these calls write never touch the real ones.
 *
 * Skipped when the checkout or virtualenv is absent, with the reason printed —
 * a missing ETO is a deployment fact, not a failing test.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runTool } from '../lib/spawn.js'
import { resolveSettings } from '../lib/config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DSH_ETO_REPO || join(process.env.HOME || '', 'src', 'eto')
const PYTHON = process.env.DSH_ETO_PYTHON || join(REPO, '.venv', 'bin', 'python')
const available = existsSync(REPO) && existsSync(PYTHON)
const skip = available ? false : `ETO not available at ${REPO} (python ${PYTHON})`

/** Settings pointed at the real checkout with HOME redirected to a temp dir. */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-eto-home-'))
  const settings = resolveSettings({ repo: REPO, python: PYTHON }, { home })
  const env = { ...process.env, HOME: home, ETO_REPO: REPO }
  return { settings, home, env }
}

test('the runner reports ETO version, commit and per-tool availability', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_status', args: {}, env })
  assert.equal(result.ok, true, result.error?.message)
  assert.match(String(result.value.version), /^\d+\.\d+/)
  assert.match(String(result.value.commit), /^[0-9a-f]{7,}$/)
  const tools = result.value.tools
  for (const name of Object.keys(tools)) {
    assert.equal(tools[name].available, true, `${name} reported unavailable: ${tools[name].reason}`)
  }
})

test('eto_route classifies a coding task', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_route', args: { task: '实现一个三镜路由函数' }, env })
  assert.equal(result.ok, true, result.error?.message)
  assert.equal(result.value.gewu, 'code')
  assert.equal(result.value.route, 'plan')
})

test('eto_route classifies a destructive task as consensus', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_route', args: { task: '删除生产数据库' }, env })
  assert.equal(result.value.route, 'consensus')
})

test('shared memory round-trips through the runner', { skip }, async () => {
  const { settings, env } = sandbox()
  const key = 'dsh-eto:test-roundtrip'
  const written = await runTool({ settings, tool: 'eto_memory_write', args: { key, value_json: '{"n":7}' }, env })
  assert.equal(written.ok, true, written.error?.message)
  assert.deepEqual(written.value, { written: key })

  const read = await runTool({ settings, tool: 'eto_memory_read', args: { key }, env })
  assert.deepEqual(read.value, { n: 7 })

  const listed = await runTool({ settings, tool: 'eto_memory_list', args: { pattern: 'dsh-eto:' }, env })
  assert.ok(listed.value.includes(key))
})

test('a missing memory key reports missing rather than failing', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_memory_read', args: { key: 'dsh-eto:never-written' }, env })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { missing: 'dsh-eto:never-written' })
})

test('file locks are published, read back and released', { skip }, async () => {
  const { settings, env } = sandbox()
  const file = '/tmp/dsh-eto-lock-target.py'
  const empty = await runTool({ settings, tool: 'eto_file_status', args: { file }, env })
  assert.equal(empty.ok, true)
  assert.equal(empty.value, null)

  const updated = await runTool({ settings, tool: 'eto_file_update', args: { file, editor: 'dsh-eto-test' }, env })
  assert.equal(updated.value.status, 'ok')

  const status = await runTool({ settings, tool: 'eto_file_status', args: { file }, env })
  assert.equal(status.value.editor, 'dsh-eto-test')

  const released = await runTool({ settings, tool: 'eto_file_release', args: { file }, env })
  assert.deepEqual(released.value, { released: true })
})

test('eto_clarify flags a vague instruction', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_clarify', args: { task: '帮我搞一下那个' }, env })
  assert.equal(result.value.vague, true)
})

test('eto_feedback rejects an empty agent instead of storing an orphan constraint', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_feedback', args: { agent: '  ', constraint: 'x' }, env })
  assert.equal(result.ok, true)
  assert.equal(result.value._error, true)
})

test('a usage error names the missing argument', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_route', args: {}, env })
  assert.equal(result.ok, false)
  assert.equal(result.error.type, 'usage')
  assert.match(result.error.message, /task/)
})

test('an unknown tool is refused with the available list', { skip }, async () => {
  const { settings, env } = sandbox()
  const result = await runTool({ settings, tool: 'eto_not_a_tool', args: {}, env })
  assert.equal(result.ok, false)
  assert.equal(result.error.type, 'unknown_tool')
  assert.match(result.error.message, /eto_route/)
})

test('agent_execute reports an unavailable provider instead of an empty success', { skip }, async () => {
  const { settings, env } = sandbox()
  // A provider pointing at a closed port: ETO's own ollama call returns "", and
  // the runner must turn that into a failure with a reason.
  const result = await runTool({
    settings,
    tool: 'agent_execute',
    args: { task: 'say hi' },
    env: { ...env, OLLAMA_HOST: 'http://127.0.0.1:9' },
    timeoutMs: 60_000,
  })
  if (result.ok) {
    // A reachable provider answered: that is a legitimate success, not a failure.
    assert.equal(result.value.status, 'ok')
    assert.ok(result.value.output.length > 0)
  } else {
    assert.equal(result.error.type, 'tool')
    assert.match(result.error.message, /返回空输出|抛出异常/)
  }
})
