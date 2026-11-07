/**
 * `eto_consensus` mode dispatch: the default, the explicit scorecard, and a
 * value the runner must refuse.
 *
 * The runner is Python, so these run the real `eto_runner.py` under a real
 * interpreter. The `eto` package is a stub on `ETO_REPO`: it records which
 * stitch function the runner called and returns the documented shape. That
 * keeps the assertion on the runner's decision — "did it take the advise
 * branch?" — instead of on ETO's scoring, which needs providers and belongs to
 * ETO's own suite.
 *
 * Skipped with a reason when no interpreter new enough to import the runner
 * (`Path | None` annotations need 3.10) is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runTool } from '../lib/spawn.js'
import { resolveSettings } from '../lib/config.js'

/**
 * Absolute path of the first interpreter that can import the runner, or
 * undefined. Absolute because `runTool` checks the interpreter with
 * `existsSync` before spawning, which a bare `python3` would fail.
 */
function findPython() {
  const candidates = [process.env.DSH_ETO_PYTHON, 'python3', 'python'].filter(Boolean)
  const probe = 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
  for (const candidate of candidates) {
    if (spawnSync(candidate, ['-c', probe]).status !== 0) continue
    // The interpreter's own report, so the path is the one it will run as.
    const resolved = spawnSync(candidate, ['-c', 'import sys; sys.stdout.write(sys.executable)'], { encoding: 'utf8' })
    const path = resolved.status === 0 ? resolved.stdout.trim() : ''
    if (path) return path
  }
  return undefined
}

const PYTHON = findPython()
const skip = PYTHON === undefined ? 'no Python >= 3.10 available (set DSH_ETO_PYTHON)' : false

/**
 * Stub `eto` package: one log line per stitch call, plus the shapes the two
 * modes are contracted to return. `peer_advise` has no `final_score`;
 * `peer_review` has one, so the caller can tell the branches apart.
 */
const STUB_VOTE = `"""Stub ETO consensus stitch used by the runner's mode tests."""
import json
from pathlib import Path

LOG = Path(__file__).resolve().parents[3] / "calls.log"


def _record(name, plan, peers):
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"fn": name, "plan": plan, "peers": peers}, ensure_ascii=False) + "\\n")


def peer_advise(plan, peers):
    _record("peer_advise", plan, list(peers))
    return {
        "mode": "advise",
        "status": "advised",
        "synthesis": "stub synthesis",
        "advice": [f"[{peer}] stub advice" for peer in peers],
        "risks": ["stub risk"],
        "disagreements": [],
        "votes": [{"peer": peer, "advice": "stub advice"} for peer in peers],
    }


def peer_review(plan, peers):
    _record("peer_review", plan, list(peers))
    return {
        "status": "approved",
        "final_score": 0.75,
        "votes": [{"peer": peer, "score": 0.75} for peer in peers],
        "deliberation": {"rounds": 0, "strategies": {}},
        "actions": [],
    }
`

/** A throwaway ETO checkout whose only content is the stub stitch. */
function stubRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'eto-consensus-mode-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const consensus = join(root, 'eto', 'stitches', 'consensus')
  mkdirSync(consensus, { recursive: true })
  for (const init of ['eto', join('eto', 'stitches'), join('eto', 'stitches', 'consensus')]) {
    writeFileSync(join(root, init, '__init__.py'), '', 'utf8')
  }
  writeFileSync(join(consensus, 'vote.py'), STUB_VOTE, 'utf8')
  return root
}

/** Every stitch call the stub saw, in order. */
function recordedCalls(root) {
  try {
    const text = readFileSync(join(root, 'calls.log'), 'utf8').trim()
    return text === '' ? [] : text.split('\n').map(line => JSON.parse(line))
  } catch {
    return []
  }
}

/** One consensus call through the same spawn path the plugin uses. */
function consensus(root, args) {
  const settings = resolveSettings({ repo: root, python: PYTHON }, { home: root })
  return runTool({ settings, tool: 'eto_consensus', args })
}

test('eto_consensus without mode takes the advise branch', { skip }, async t => {
  const root = stubRepo(t)
  const result = await consensus(root, { plan: '重构登录模块' })

  assert.equal(result.ok, true, result.error?.message)
  assert.deepEqual(recordedCalls(root).map(call => call.fn), ['peer_advise'])
  assert.ok(Array.isArray(result.value.advice) && result.value.advice.length > 0, 'advise result needs advice')
  assert.equal('final_score' in result.value, false, 'advise must not carry a score')
  // Default peers still reach the stitch when the caller names none.
  assert.deepEqual(recordedCalls(root)[0].peers, ['researcher', 'coder', 'auditor'])
})

test('eto_consensus mode="review" takes the scorecard branch', { skip }, async t => {
  const root = stubRepo(t)
  const result = await consensus(root, { plan: '重构登录模块', mode: 'review' })

  assert.equal(result.ok, true, result.error?.message)
  assert.deepEqual(recordedCalls(root).map(call => call.fn), ['peer_review'])
  assert.equal(typeof result.value.final_score, 'number')
  assert.equal('advice' in result.value, false, 'review must not carry advice')
})

test('eto_consensus refuses an unknown mode as a usage error', { skip }, async t => {
  const root = stubRepo(t)
  const result = await consensus(root, { plan: '重构登录模块', mode: 'foo' })

  assert.equal(result.ok, false)
  assert.equal(result.error.type, 'usage')
  assert.match(result.error.message, /mode/)
  assert.match(result.error.message, /advise/)
  assert.match(result.error.message, /review/)
  // Refused before dispatch: no stitch was consulted.
  assert.deepEqual(recordedCalls(root), [])
})
