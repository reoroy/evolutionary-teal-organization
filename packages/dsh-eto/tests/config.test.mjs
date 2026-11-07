/**
 * Config resolution and the page-facing view.
 *
 * The interesting properties: defaults are computed (never a path in the patch
 * file), `~` survives the round trip to the page, and a volatile reference is
 * read through its accessor rather than treated as an object.
 */
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import test from 'node:test'
import z from '@deepseek-ai/schemastery'
import { Config, abbreviateHome, expandHome, resolveSettings, settingsView } from '../lib/config.js'

test('defaults derive from the home directory, not from the environment', () => {
  const settings = resolveSettings({}, { home: '/home/tester' })
  assert.equal(settings.repo, '/home/tester/src/eto')
  assert.equal(settings.venv, '/home/tester/src/eto/.venv')
  assert.match(settings.python, /\/home\/tester\/src\/eto\/\.venv\/(bin\/python|Scripts\/python\.exe)$/)
  assert.equal(settings.toolTimeoutMs, 180_000)
  assert.deepEqual(settings.enabledTools, [])
})

test('a configured repo re-derives the venv and interpreter beneath it', () => {
  const settings = resolveSettings({ repo: '/work/eto' }, { home: '/h' })
  assert.equal(settings.venv, '/work/eto/.venv')
  assert.match(settings.python, /^\/work\/eto\/\.venv\//)
})

test('an explicit venv or python wins over the derived one', () => {
  const settings = resolveSettings({ repo: '/work/eto', venv: '/venvs/e', python: '/opt/python3' }, { home: '/h' })
  assert.equal(settings.venv, '/venvs/e')
  assert.equal(settings.python, '/opt/python3')
})

test('volatile references are read through their accessor', () => {
  // The Loader hands volatile fields over as cosmokit references, not plain values.
  const config = Config({ repo: '/from/loader', toolTimeoutMs: 42_000, enabledTools: ['eto_route'] })
  const settings = resolveSettings(config, { home: '/h' })
  assert.equal(settings.repo, '/from/loader')
  assert.equal(settings.toolTimeoutMs, 42_000)
  assert.deepEqual(settings.enabledTools, ['eto_route'])
})

test('blank and whitespace-only entries fall back to the default', () => {
  const settings = resolveSettings({ repo: '   ', venv: '', enabledTools: ['  ', 'eto_route', ''] }, { home: '/h' })
  assert.equal(settings.repo, '/h/src/eto')
  assert.equal(settings.venv, '/h/src/eto/.venv')
  assert.deepEqual(settings.enabledTools, ['eto_route'])
})

test('~ is expanded on read and abbreviated on the way to the page', () => {
  assert.equal(expandHome('~/src/eto'), '/h/src/eto'.replace('/h', homedir()))
  assert.equal(abbreviateHome(homedir() + '/src/eto'), '~/src/eto')
  assert.equal(abbreviateHome('/opt/eto'), '/opt/eto')
  assert.equal(abbreviateHome(''), '')
})

test('the page view carries no absolute home path', () => {
  const settings = resolveSettings({ repo: homedir() + '/src/eto' }, { home: homedir() })
  const view = settingsView(settings)
  assert.ok(!view.repo.startsWith('/'), `expected a ~-relative path, got ${view.repo}`)
  assert.ok(!view.python.startsWith('/'), `expected a ~-relative path, got ${view.python}`)
})

test('the schema rejects a timeout below the floor', () => {
  assert.throws(() => Config({ toolTimeoutMs: 10 }))
})

test('delegateModel defaults to the stated route and includeFullResult is off', () => {
  const settings = resolveSettings({}, { home: '/h' })
  assert.equal(settings.delegateModel, 'deepseek-official/deepseek-flash')
  assert.equal(settings.includeFullResult, false)

  const on = resolveSettings({ includeFullResult: true, delegateModel: 'dsh/x' }, { home: '/h' })
  assert.equal(on.includeFullResult, true)
  assert.equal(on.delegateModel, 'dsh/x')
})
