/**
 * The spawn boundary: environment scrub, sentinel parsing, timeouts and the
 * failure text the model actually reads.
 *
 * These run against a real child process (a fake interpreter script) because
 * every interesting property here — a deadline that kills the process, a
 * timeout that survives an exit code of 0, diagnostics reaching the error — only
 * exists in the operating system, not in a stub.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { childEnv, parseRunnerOutput, runTool } from '../lib/spawn.js'
import { resolveSettings } from '../lib/config.js'

/** A settings object pointing `python` at a generated script and `repo` at a temp dir. */
function withFakePython(body) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eto-spawn-'))
  const script = join(dir, 'fake-python')
  writeFileSync(script, `#!/usr/bin/env node\n${body}\n`, 'utf8')
  chmodSync(script, 0o755)
  return { settings: resolveSettings({ repo: dir, python: script }, { home: dir }), dir }
}

test('childEnv drops credential-looking names and keeps the rest', () => {
  const settings = resolveSettings({ repo: '/repo', envPassthrough: ['OLLAMA_HOST'] }, { home: '/h' })
  const env = childEnv(settings, {
    PATH: '/usr/bin',
    HOME: '/h',
    DEEPSEEK_API_KEY: 'secret',
    ANTHROPIC_AUTH_TOKEN: 'secret',
    MY_PASSWORD: 'secret',
    OLLAMA_HOST: 'http://127.0.0.1:11434',
  })
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/h')
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(env.MY_PASSWORD, undefined)
  // An explicit passthrough wins even when the name looks like a credential ref.
  assert.equal(env.OLLAMA_HOST, 'http://127.0.0.1:11434')
  assert.equal(env.ETO_REPO, '/repo')
})

test('childEnv forwards an explicitly listed secret name', () => {
  const settings = resolveSettings({ repo: '/repo', envPassthrough: ['DEEPSEEK_API_KEY'] }, { home: '/h' })
  const env = childEnv(settings, { DEEPSEEK_API_KEY: 'deliberate' })
  assert.equal(env.DEEPSEEK_API_KEY, 'deliberate')
})

test('parseRunnerOutput takes the last sentinel and keeps the rest as noise', () => {
  const { payload, noise } = parseRunnerOutput('ETO boot log\n__ETO_RESULT__{"ok":true,"result":{"a":1}}\ntrailing\n')
  assert.deepEqual(payload, { ok: true, result: { a: 1 } })
  assert.match(noise, /ETO boot log/)
  assert.match(noise, /trailing/)
})

test('parseRunnerOutput ignores a corrupt sentinel and finds an earlier good one', () => {
  const { payload } = parseRunnerOutput('__ETO_RESULT__{"ok":true}\n__ETO_RESULT__{not json')
  assert.deepEqual(payload, { ok: true })
})

test('parseRunnerOutput reports no payload when nothing was printed', () => {
  assert.equal(parseRunnerOutput('').payload, null)
  assert.equal(parseRunnerOutput('only logs').payload, null)
})

test('a successful call returns the canonical value', async () => {
  const { settings } = withFakePython('process.stdout.write("__ETO_RESULT__" + JSON.stringify({ ok: true, result: { route: "plan" } }))')
  const result = await runTool({ settings, tool: 'eto_route', args: { task: 'x' } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { route: 'plan' })
  assert.equal(result.timedOut, false)
  assert.equal(result.exitCode, 0)
})

test('a reported failure keeps its type and message', async () => {
  const { settings } = withFakePython('process.stdout.write("__ETO_RESULT__" + JSON.stringify({ ok: false, error: { type: "usage", message: "missing plan" } }))')
  const result = await runTool({ settings, tool: 'eto_consensus', args: {} })
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { type: 'usage', message: 'missing plan' })
})

test('a timeout kills the child, reports timedOut, and is not a success', async () => {
  const { settings } = withFakePython('setTimeout(() => {}, 60_000)')
  const started = Date.now()
  const result = await runTool({ settings, tool: 'eto_route', args: {}, timeoutMs: 300 })
  const elapsed = Date.now() - started
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.match(result.error.message, /did not answer within 300 ms/)
  // The deadline must actually end the call, not just ask the child to stop.
  assert.ok(elapsed < 10_000, `runTool returned after ${elapsed} ms`)
})

test('a late answer after the deadline reports success and timeout as separate facts', async () => {
  // The orthogonal-reporting rule: `timedOut` must not be nested inside the exit
  // status. A child that ignores SIGTERM and answers anyway produces a usable
  // value AND a deadline that elapsed; both survive into the result.
  const { settings } = withFakePython(`
    process.on('SIGTERM', () => {})
    setTimeout(() => {
      process.stdout.write('__ETO_RESULT__' + JSON.stringify({ ok: true, result: { late: true } }))
      process.exit(0)
    }, 600)
  `)
  const result = await runTool({ settings, tool: 'eto_route', args: {}, timeoutMs: 300 })
  assert.equal(result.ok, true, 'the value the child did produce is still usable')
  assert.equal(result.timedOut, true, 'and the elapsed deadline is reported beside it')
  assert.deepEqual(result.value, { late: true })
  assert.equal(result.exitCode, 0)
})

test('caller cancellation aborts the child without claiming a timeout', async () => {
  const { settings } = withFakePython('setTimeout(() => {}, 60_000)')
  const controller = new AbortController()
  const pending = runTool({ settings, tool: 'eto_route', args: {}, signal: controller.signal, timeoutMs: 60_000 })
  setTimeout(() => controller.abort(), 150)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, false, 'cancellation must not be reported as a deadline')
  assert.match(result.error.message, /no result/)
})

test('a missing interpreter is reported before any spawn', async () => {
  const settings = resolveSettings({ repo: '/nonexistent', python: '/nonexistent/python' }, { home: '/h' })
  const result = await runTool({ settings, tool: 'eto_route', args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.type, 'setup')
  assert.match(result.error.message, /interpreter not found/)
  assert.match(result.error.message, /python3 -m venv/)
})

test('child stderr and stdout noise reach the error message', async () => {
  const { settings } = withFakePython(`
    process.stderr.write('Traceback: boom')
    process.exit(3)
  `)
  const result = await runTool({ settings, tool: 'eto_route', args: {} })
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 3)
  assert.match(result.error.message, /Traceback: boom/)
  assert.match(result.error.message, /exit 3/)
})
