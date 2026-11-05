/**
 * One spawned ETO call: `<python> <plugin>/lib/eto_runner.py <tool>`, arguments
 * on stdin, one result on stdout.
 *
 * The MCP bridge this replaces paid a handshake, a persistent child and a
 * protocol translation per call; a Python stitch call is milliseconds of work,
 * so a short-lived process is both simpler and cheaper to reason about. What
 * that costs is process discipline, which is all this module owns:
 *
 * - a deadline that actually kills the child (SIGTERM, then SIGKILL) and waits
 *   for `close`, so dispose reaches quiescence instead of leaving an orphan;
 * - `timedOut`, `exitCode` and `signal` reported as three independent facts —
 *   a process that catches SIGTERM and exits 0 is still a timeout;
 * - a scrubbed environment, because ETO shells out to providers and its own
 *   traces end up in model context.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** The runner ships beside this module; the ETO checkout is resolved separately. */
export const RUNNER = join(HERE, 'eto_runner.py')

/** Names the environment scrub always drops, whatever the config says. */
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i

/** Grace between SIGTERM and SIGKILL for a child that ignores the first signal. */
const KILL_GRACE_MS = 2_000

/** A tool result, before it is shaped into the tool's canonical value. */
export class SpawnResult {
  constructor({ ok, value, error, timedOut, exitCode, signal, stdout, stderr, durationMs }) {
    this.ok = ok
    this.value = value
    this.error = error
    this.timedOut = timedOut
    this.exitCode = exitCode
    this.signal = signal
    this.stdout = stdout
    this.stderr = stderr
    this.durationMs = durationMs
  }

  /** One line naming every independent fact, for the model-facing error. */
  describe() {
    const facts = []
    if (this.timedOut) facts.push('timed out')
    if (this.signal !== null) facts.push(`signal ${this.signal}`)
    if (this.exitCode !== null) facts.push(`exit ${this.exitCode}`)
    return facts.length > 0 ? facts.join(', ') : 'no exit status'
  }
}

/**
 * Build the child environment: the harness's own baseline minus anything whose
 * name looks like a credential, plus the caller's explicit passthrough list.
 * `ETO_REPO` is always set so the runner imports from the configured checkout.
 * @param {object} settings - resolved plugin settings.
 * @param {NodeJS.ProcessEnv} base - ambient environment (test seam).
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(settings, base = process.env) {
  const env = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (SECRET_NAME.test(name)) continue
    env[name] = value
  }
  for (const name of settings.envPassthrough ?? []) {
    const value = base[name]
    if (value !== undefined) env[name] = value
  }
  env.ETO_REPO = settings.repo
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUNBUFFERED = '1'
  return env
}

/**
 * Parse the runner's sentinel line out of whatever the child printed.
 * ETO stitches log to stdout, so the last sentinel line wins and anything else
 * is kept for diagnostics.
 * @param {string} stdout
 * @returns {{ payload: object | null, noise: string }}
 */
export function parseRunnerOutput(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/)
  let payload = null
  let payloadLine = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line.startsWith('__ETO_RESULT__')) continue
    try {
      payload = JSON.parse(line.slice('__ETO_RESULT__'.length))
      payloadLine = index
      break
    } catch {
      // A truncated or corrupted sentinel is not a result; keep looking up.
    }
  }
  const noise = lines
    .filter((_, index) => index !== payloadLine)
    .join('\n')
    .trim()
  return { payload, noise }
}

/** Last N characters of a stream, for an error message that stays readable. */
const tail = (text, limit = 1_200) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : '…' + value.slice(-limit)
}

/**
 * Run one ETO tool.
 * @param {object} options
 * @param {object} options.settings - resolved plugin settings.
 * @param {string} options.tool - runner tool name.
 * @param {object} options.args - tool arguments (JSON).
 * @param {AbortSignal} [options.signal] - caller cancellation (tool execution).
 * @param {NodeJS.ProcessEnv} [options.env] - environment override (test seam).
 * @param {number} [options.timeoutMs] - deadline; defaults to the settings value.
 * @returns {Promise<SpawnResult>}
 */
export function runTool({ settings, tool, args, signal, env, timeoutMs }) {
  return new Promise(resolve => {
    const started = Date.now()
    const limit = Number.isFinite(timeoutMs) ? timeoutMs : settings.toolTimeoutMs
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer = null

    const finish = (exitCode, termSignal, extra = {}) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      if (killTimer !== null) clearTimeout(killTimer)
      const durationMs = Date.now() - started
      const { payload, noise } = parseRunnerOutput(stdout)
      const diagnostics = [tail(noise), tail(stderr)].filter(Boolean).join('\n')

      if (payload === null) {
        const reason = timedOut
          ? `ETO did not answer within ${limit} ms`
          : `ETO runner produced no result (${[timedOut && 'timed out', termSignal && `signal ${termSignal}`, `exit ${exitCode}`].filter(Boolean).join(', ')})`
        resolve(new SpawnResult({
          ok: false,
          value: undefined,
          error: {
            type: timedOut ? 'timeout' : 'runner',
            message: diagnostics ? `${reason}\n${diagnostics}` : reason,
          },
          timedOut,
          exitCode,
          signal: termSignal,
          stdout,
          stderr,
          durationMs,
          ...extra,
        }))
        return
      }

      if (payload.ok === true) {
        resolve(new SpawnResult({
          ok: true,
          value: payload.result,
          error: null,
          timedOut,
          exitCode,
          signal: termSignal,
          stdout,
          stderr,
          durationMs,
          ...extra,
        }))
        return
      }

      const reported = payload.error && typeof payload.error === 'object' ? payload.error : {}
      resolve(new SpawnResult({
        ok: false,
        value: undefined,
        error: {
          type: typeof reported.type === 'string' ? reported.type : 'tool',
          message: typeof reported.message === 'string' ? reported.message : 'ETO reported a failure without a message',
        },
        timedOut,
        exitCode,
        signal: termSignal,
        stdout,
        stderr,
        durationMs,
        ...extra,
      }))
    }

    if (!existsSync(settings.python)) {
      resolve(new SpawnResult({
        ok: false,
        error: {
          type: 'setup',
          message: `ETO interpreter not found: ${settings.python}\nCreate it: cd ${settings.repo} && python3 -m venv .venv && .venv/bin/pip install -e eto/`,
        },
        timedOut: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
      }))
      return
    }
    if (!existsSync(RUNNER)) {
      resolve(new SpawnResult({
        ok: false,
        error: { type: 'setup', message: `dsh-eto runner missing from the plugin: ${RUNNER}` },
        timedOut: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
      }))
      return
    }

    let child
    try {
      child = spawn(settings.python, [RUNNER, tool], {
        cwd: settings.repo,
        env: env ?? childEnv(settings),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve(new SpawnResult({
        ok: false,
        error: { type: 'spawn', message: `could not start ${settings.python}: ${error instanceof Error ? error.message : String(error)}` },
        timedOut: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - started,
      }))
      return
    }

    const terminate = () => {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }, KILL_GRACE_MS)
      killTimer.unref?.()
    }

    const deadlineTimer = setTimeout(() => {
      timedOut = true
      terminate()
    }, limit)
    deadlineTimer.unref?.()

    const onAbort = () => {
      // Caller cancellation kills the same way a deadline does, but is NOT a
      // timeout: the two facts stay separate.
      terminate()
    }
    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const detach = () => signal?.removeEventListener('abort', onAbort)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      detach()
      finish(null, null, { spawnError: error instanceof Error ? error.message : String(error) })
    })
    child.on('close', (code, termSignal) => {
      detach()
      finish(code, termSignal)
    })

    try {
      child.stdin.end(JSON.stringify(args ?? {}), 'utf8')
    } catch {
      // The child may exit before stdin closes; `close` still settles the call.
    }
  })
}
