/**
 * Review ledger: the on-disk record of every consensus review.
 *
 * A review is persisted the moment `eto_consensus` completes (see tools.js) and
 * read back by the panel through `GET /@dsh-eto/api/reviews`. One JSON file per
 * review, named by the `audit_id` ETO already assigns — the panel never invents
 * an identity for a record ETO named. A corrupt or partial file is skipped, and
 * a failed write never costs the model the review result itself.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Reviews live under ETO's own data root, `~/.eto`. */
export function reviewsDir(home = homedir()) {
  return join(home, '.eto', 'reviews')
}

/** Turn an audit id into a safe file-name component (never empty). */
function safeName(id) {
  const value = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '')
  return value === '' ? `v${Date.now()}` : value
}

/** A file name for `auditId` that does not collide with an existing record. */
function fileFor(dir, auditId) {
  const base = safeName(auditId)
  let name = `${base}.json`
  let n = 1
  while (existsSync(join(dir, name))) {
    name = `${base}-${n}.json`
    n += 1
  }
  return name
}

/**
 * Write one review record to the ledger (best-effort).
 * @param {object} record - the review record; its `audit_id` names the file.
 * @param {string} [home] - test seam for the home directory.
 * @returns {{ ok: boolean, file?: string, error?: string }}
 */
export function persistReview(record, home = homedir()) {
  try {
    const dir = reviewsDir(home)
    mkdirSync(dir, { recursive: true })
    const file = fileFor(dir, record?.audit_id)
    writeFileSync(join(dir, file), JSON.stringify(record, null, 2), 'utf8')
    return { ok: true, file }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Parse one ledger file; returns the record, or null when it is unusable. */
function readRecordFile(recordPath) {
  try {
    const value = JSON.parse(readFileSync(recordPath, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return value
  } catch {
    return null
  }
}

/**
 * Every review, newest first. A missing directory is an empty list, and a
 * corrupt file is skipped rather than failing the whole browse.
 * @param {string} [home] - test seam for the home directory.
 * @returns {Array<object>} records, each carrying the ledger `id` (its file name).
 */
export function listReviews(home = homedir()) {
  const dir = reviewsDir(home)
  const records = []
  try {
    if (!existsSync(dir)) return records
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const value = readRecordFile(join(dir, name))
      if (value === null) continue
      records.push({ ...value, id: name.slice(0, -'.json'.length) })
    }
  } catch {
    return records
  }
  return records.sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0))
}

/**
 * One review by ledger id (the file name, with or without its `.json` suffix),
 * or null when it does not exist or cannot be parsed.
 * @param {string} id
 * @param {string} [home] - test seam for the home directory.
 * @returns {object | null}
 */
export function readReview(id, home = homedir()) {
  const safe = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '')
  if (safe === '') return null
  const name = safe.endsWith('.json') ? safe : `${safe}.json`
  const value = readRecordFile(join(reviewsDir(home), name))
  if (value === null) return null
  return { ...value, id: name.slice(0, -'.json'.length) }
}
