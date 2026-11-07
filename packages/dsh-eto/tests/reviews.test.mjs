/**
 * Review ledger: persistence and the two read routes the panel depends on.
 *
 * The on-disk helpers are exercised directly against a temp home directory, and
 * the routes through the same `apply()` double the other route tests use, with
 * `HOME` pointed at that temp directory so the routes and helpers agree.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { listReviews, persistReview, readReview, reviewsDir } from '../lib/reviews.js'

/** A minimal cordis context, matching the shape `apply()` relies on. */
function fakeCtx(services = {}) {
  const registered = new Map()
  const routes = []
  const logs = []
  const ctx = {
    logger: { info: m => logs.push(['info', String(m)]), warn: m => logs.push(['warn', String(m)]) },
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    get: name => services[name],
    on() { return () => {} },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
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

const webServer = routes => ({
  register(route) {
    routes.push(route)
    return () => {}
  },
})

async function callRoute(routes, { path, method = 'GET' }) {
  const route = routes.find(candidate => path.startsWith(candidate.path))
  assert.ok(route, `no route matched ${path}`)
  const req = { url: path, method, headers: { host: '127.0.0.1:3080', 'x-dsh-eto': '1' } }
  const res = {
    statusCode: 0,
    headers: {},
    payload: '',
    writeHead(code, extra) { this.statusCode = code; this.headers = extra ?? {} },
    end(text) { this.payload += text ?? '' },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null }
}

const withTempHome = (fn) => {
  const home = mkdtempSync(join(tmpdir(), 'eto-reviews-'))
  const previous = process.env.HOME
  try {
    fn(home)
  } finally {
    process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

test('persistReview writes one file per audit_id and listReviews reads newest first', () => {
  withTempHome(home => {
    assert.equal(persistReview({ audit_id: 'v1', at: '2026-11-06T10:00:00.000Z', status: 'revise' }, home).ok, true)
    assert.equal(persistReview({ audit_id: 'v2', at: '2026-11-06T11:00:00.000Z', status: 'approved' }, home).ok, true)

    const list = listReviews(home)
    assert.equal(list.length, 2)
    assert.equal(list[0].id, 'v2')
    assert.equal(list[1].id, 'v1')

    const one = readReview('v2', home)
    assert.equal(one.status, 'approved')
    assert.equal(one.id, 'v2')
  })
})

test('a colliding audit_id gets a unique file name instead of overwriting', () => {
  withTempHome(home => {
    const first = persistReview({ audit_id: 'v1', at: '2026-11-06T10:00:00.000Z' }, home)
    const second = persistReview({ audit_id: 'v1', at: '2026-11-06T11:00:00.000Z' }, home)
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.notEqual(first.file, second.file)
    assert.equal(listReviews(home).length, 2)
  })
})

test('readReview sanitizes the id and answers null for a missing record', () => {
  withTempHome(home => {
    assert.equal(readReview('../etc/passwd', home), null)
    assert.equal(readReview('nope', home), null)
    assert.equal(reviewsDir(home), join(home, '.eto', 'reviews'))
  })
})

test('GET /reviews lists persisted records and /reviews/<id> reads one', async () => {
  const home = mkdtempSync(join(tmpdir(), 'eto-reviews-'))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    persistReview({ audit_id: 'v9', at: '2026-11-06T12:00:00.000Z', status: 'approved', final_score: 0.75, votes: [], plan: 'do the thing' }, home)

    const routes = []
    const { ctx } = fakeCtx({ webServer: webServer(routes) })
    apply(ctx, { repo: '/definitely/not/here' })

    const list = await callRoute(routes, { path: '/@dsh-eto/api/reviews' })
    assert.equal(list.status, 200)
    assert.equal(list.body.reviews.length, 1)
    assert.equal(list.body.reviews[0].id, 'v9')

    const detail = await callRoute(routes, { path: '/@dsh-eto/api/reviews/v9' })
    assert.equal(detail.status, 200)
    assert.equal(detail.body.status, 'approved')

    const missing = await callRoute(routes, { path: '/@dsh-eto/api/reviews/nope' })
    assert.equal(missing.status, 404)
  } finally {
    process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a legacy scorecard record stays readable beside a consultation record', () => {
  // Both shapes live in the same ledger: the retired scorecard (status + final_score + votes) and the
  // consultation (synthesis + advice/risks/disagreements). The panel must read the old files after the
  // default mode moved to `advise` — otherwise every historical entry becomes unopenable.
  const home = mkdtempSync(join(tmpdir(), 'eto-reviews-mixed-'))
  const legacy = {
    audit_id: 'legacy-1', at: '2026-11-01T00:00:00.000Z', plan: '旧格式',
    status: 'approved', final_score: 0.78,
    votes: [{ peer: 'coder', score: 0.7, concern: '边界情况', provider: 'ollama', model: 'qwen3-8b-arb' }],
  }
  const advised = {
    audit_id: 'advise-1', at: '2026-11-07T00:00:00.000Z', plan: '新格式',
    synthesis: '先补回滚方案再合并',
    advice: ['补回滚', '明确验收'], risks: ['不可回滚'], disagreements: ['coder 认为要拆小'],
  }
  persistReview(legacy, home)
  persistReview(advised, home)

  const list = listReviews(home)
  assert.equal(list.length, 2, 'both records must be listed')

  const old = readReview('legacy-1', home)
  assert.equal(old.status, 'approved')
  assert.equal(old.final_score, 0.78)

  const fresh = readReview('advise-1', home)
  assert.equal(fresh.synthesis, '先补回滚方案再合并')
  assert.deepEqual(fresh.advice, ['补回滚', '明确验收'])
  assert.equal(fresh.final_score, undefined, 'a consultation carries no score')
})
