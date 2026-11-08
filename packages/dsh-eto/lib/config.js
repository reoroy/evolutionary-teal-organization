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
  /**
   * Consultation peers as a STRUCTURED array, not a JSON string.
   *
   * dsh-moa does it this way (§ PresetSchema) and it is the reason its settings stick: a real
   * schema means the host's configForms owns the value end to end — it round-trips through the
   * snapshot, validates it, and the panel reads back exactly what was written. A JSON blob in a
   * `z.string()` only round-trips if every reader remembers to parse it, and it does not survive
   * the settings pipeline, which is why a hand-rolled version kept snapping back to defaults.
   *
   * `provider` is `ollama` (direct HTTP, honours `host`) or `dsh` (host llm service, model is
   * `provider/model`). An empty `model` means "use the built-in default for this role".
   */
  peers: z.array(z.object({
    role: z.string().default(''),
    provider: z.string().default(''),
    model: z.string().default(''),
    host: z.string().default(''),
  })).default([]).volatile(),
  /** LAN Ollama base URL (e.g. http://192.168.10.4:11434); empty = the local daemon only. */
  ollamaRemote: z.string().default('').volatile(),
  /** Always append the full consensus JSON to the fused reply (else only on request). */
  includeFullResult: z.boolean().default(false).volatile(),
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

/** Roles the consultation understands, in prompt order. */
export const PEER_ROLES = ['researcher', 'coder', 'auditor']

/**
 * Clean a `peers` array from settings. Unknown roles and blank entries are dropped so a stale
 * saved value cannot inject a peer that vote.py would never call.
 */
export function normalizePeers(candidate) {
  if (!Array.isArray(candidate)) return []
  const out = []
  const seen = new Set()
  for (const entry of candidate) {
    if (!entry || typeof entry !== 'object') continue
    const role = String(entry.role ?? '').trim()
    if (!PEER_ROLES.includes(role) || seen.has(role)) continue
    const provider = String(entry.provider ?? '').trim()
    const model = String(entry.model ?? '').trim()
    // Only drop a row when the operator cleared the provider (meaning "use the built-in default").
    // An empty model must SURVIVE: the editor writes provider first and the model second, and
    // dropping the half-filled row is what made a provider selection snap back to "default".
    if (provider === '') continue
    seen.add(role)
    out.push({ role, provider, model, host: String(entry.host ?? '').trim() })
  }
  return out
}

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
  const bool = (candidate, fallback) => {
    const resolved = current(candidate)
    return typeof resolved === 'boolean' ? resolved : fallback
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
    // Both are volatile settings. Without them here, a saved value is dropped on resolve and
    // the panel reads back the empty default — the "selection doesn't stick" symptom.
    peers: normalizePeers(value.peers),
    ollamaRemote: str(value.ollamaRemote, ''),
    includeFullResult: bool(value.includeFullResult, false),
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
    // These two must appear in the view or the configForms snapshot never carries them:
    // the settings page then drafts them as undefined and every peer choice snaps back to default.
    peers: settings.peers,
    ollamaRemote: settings.ollamaRemote,
    includeFullResult: settings.includeFullResult,
    envPassthrough: settings.envPassthrough,
  }
}
