/**
 * dsh-eto host configuration: the Loader entry schema plus the plain snapshot
 * every consumer reads.
 *
 * Every field is `.volatile()`: the settings service only edits volatile fields
 * (dsh 0.1.7+) and commits a volatile-only change into the running references
 * without remounting the plugin. Consumers therefore resolve the snapshot on
 * every tool call instead of caching it in `apply`.
 *
 * The defaults are computed, never hard-coded paths in the patch file: the
 * checkout lives at `$DSH_ETO_REPO` or `~/src/eto`, its virtualenv next to it.
 */
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const Config = z.object({
  /** ETO checkout; empty = $DSH_ETO_REPO, else ~/src/eto. */
  repo: z.string().default('').volatile(),
  /** Virtualenv root; empty = <repo>/.venv. */
  venv: z.string().default('').volatile(),
  /** Interpreter; empty = <venv>/bin/python (Scripts/python.exe on Windows). */
  python: z.string().default('').volatile(),
  /** Tool whitelist by name; empty = every tool. */
  enabledTools: z.array(z.string()).default([]).volatile(),
  /** Deadline for one spawned ETO call. */
  toolTimeoutMs: z.number().min(1_000).max(3_600_000).default(180_000).volatile(),
  /** Optional provider route for `eto_peer_score`; empty = the session's model. */
  peerScoreProvider: z.string().default('').volatile(),
  /** Optional model id for `eto_peer_score`; must be paired with the provider. */
  peerScoreModel: z.string().default('').volatile(),
  /** Deadline for one `eto_peer_score` model call. */
  peerScoreTimeoutMs: z.number().min(5_000).max(600_000).default(90_000).volatile(),
  /** `provider/model` route the direct-answer delegate uses (routing gate A). */
  delegateModel: z.string().default('deepseek-official/deepseek-flash').volatile(),
  /** Environment names forwarded to the child, beyond the non-secret baseline. */
  envPassthrough: z.array(z.string()).default([]).volatile(),
})

/** Volatile references are cosmokit objects shared across copies; read by symbol. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Read one config value that may be a volatile reference or a plain value. */
function current(value) {
  if (typeof value === 'object' && value !== null && VOLATILE_WRITE in value) return value.get()
  return value
}

/** Expand a leading `~` (the settings page edits the abbreviated form). */
export function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

/** Abbreviate the home directory so the page never receives an absolute home path. */
export function abbreviateHome(value) {
  const text = String(value ?? '')
  const home = homedir()
  if (!text) return ''
  if (text === home) return '~'
  if (text.startsWith(home + '/') || text.startsWith(home + '\\')) return '~/' + text.slice(home.length + 1)
  return text
}

const pythonIn = venv => (process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python'))

/**
 * Resolve the Loader's parsed entry config into the plain object consumers read.
 * Call again after `loader/volatile-update`; the references are the same objects
 * holding new values, so no listener bookkeeping is needed.
 * @param {unknown} raw - parsed entry config (fields may be volatile references).
 * @param {{ home?: string }} [options] - test seam for the home directory.
 * @returns resolved settings plus the effective ETO layout.
 */
export function resolveSettings(raw, options = {}) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const home = options.home ?? homedir()
  const str = (candidate, fallback) => {
    const resolved = current(candidate)
    return typeof resolved === 'string' && resolved.trim() !== '' ? expandHome(resolved) : fallback
  }
  const num = (candidate, fallback) => {
    const resolved = current(candidate)
    return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : fallback
  }
  const list = candidate => {
    const resolved = current(candidate)
    return Array.isArray(resolved) ? resolved.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim()) : []
  }

  const repo = str(value.repo, expandHome(process.env.DSH_ETO_REPO ?? '') || join(home, 'src', 'eto'))
  const venv = str(value.venv, expandHome(process.env.DSH_ETO_VENV ?? '') || join(repo, '.venv'))
  const python = str(value.python, expandHome(process.env.DSH_ETO_PYTHON ?? '') || pythonIn(venv))

  return {
    repo,
    venv,
    python,
    enabledTools: list(value.enabledTools),
    toolTimeoutMs: num(value.toolTimeoutMs, 180_000),
    peerScoreProvider: str(value.peerScoreProvider, ''),
    peerScoreModel: str(value.peerScoreModel, ''),
    peerScoreTimeoutMs: num(value.peerScoreTimeoutMs, 90_000),
    delegateModel: str(value.delegateModel, 'deepseek-official/deepseek-flash'),
    envPassthrough: list(value.envPassthrough),
  }
}

/** The page-facing view: `~`-abbreviated paths and no other local facts. */
export function settingsView(settings) {
  return {
    repo: abbreviateHome(settings.repo),
    venv: abbreviateHome(settings.venv),
    python: abbreviateHome(settings.python),
    enabledTools: settings.enabledTools,
    toolTimeoutMs: settings.toolTimeoutMs,
    peerScoreProvider: settings.peerScoreProvider,
    peerScoreModel: settings.peerScoreModel,
    peerScoreTimeoutMs: settings.peerScoreTimeoutMs,
    delegateModel: settings.delegateModel,
    envPassthrough: settings.envPassthrough,
  }
}
