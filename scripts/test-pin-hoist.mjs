/**
 * Regression test for the "hoist pinned sessions" view option.
 *
 * A pin is a statement about prominence in the WHOLE list, so the default
 * lifts the pinned Session out of its category and renders it in one global
 * section above every category. The view option turns that off: the pinned
 * Session stays in the category that owns it and merely leads that category.
 *
 * This test pins both branches at the level the renderer consumes (the
 * projected tree), because a UI click can only prove the default branch —
 * the off branch has no visible affordance to click.
 *
 * Run: node scripts/test-pin-hoist.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(
  here, '..', 'packages', 'client', 'ui-session-categories', 'src', 'client', 'tree.ts',
)

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pin-hoist-'))
try {
  const out = path.join(tmp, 'tree.mjs')
  await build({
    entryPoints: [sourcePath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    absWorkingDir: path.join(here, '..'),
    logLevel: 'silent',
    plugins: [{
      name: 'stub-client-store',
      setup(b) {
        b.onResolve({ filter: /^@deepseek-ai\/dsh-client-store$/ }, () => ({ path: 'dsh-client-store', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const defineStore = (s) => s', loader: 'js' }))
      },
    }],
  })
  const { buildCategoryTree } = await import(pathToFileURL(out).href)

  const cat = (id, order, parentId = null) => ({ id, title: id, order, parentId })
  const snapshot = {
    categories: [cat('alpha', 1), cat('beta', 2)],
    assignments: [
      { sessionId: 's-pinned', categoryId: 'alpha' },
      { sessionId: 's-plain', categoryId: 'alpha' },
      { sessionId: 's-other', categoryId: 'beta' },
      { sessionId: 's-loose', categoryId: null },
    ],
  }
  const sessions = ['s-pinned', 's-plain', 's-other', 's-loose'].map((id, i) => ({
    id, displayTitle: id, blank: false, running: false, completed: true, origin: 'user', updatedAt: i,
  }))
  const view = { expandedCategories: ['alpha', 'beta'], expandedCategoryState: { alpha: true, beta: true } }

  const flat = (group) => ({
    pinned: group.pinnedSessions.map((s) => s.id),
    alpha: group.categories.find((c) => c.id === 'alpha').sessions.map((s) => s.id),
    beta: group.categories.find((c) => c.id === 'beta').sessions.map((s) => s.id),
    loose: group.unclassifiedSessions.map((s) => s.id),
  })

  const results = []
  const test_ = (name, fn) => {
    try { fn(); results.push('  ok   ' + name) }
    catch (e) { results.push('  FAIL ' + name + ' — ' + e.message); process.exitCode = 1 }
  }

  console.log('hoist on (default)')
  test_('the pinned session leaves its category and leads the global section', () => {
    const g = buildCategoryTree(snapshot, sessions, view, ['s-pinned'], [], true)
    const f = flat(g)
    assert.deepEqual(f.pinned, ['s-pinned'])
    assert.deepEqual(f.alpha, ['s-plain'])
  })

  test_('the unclassified tail drops the pinned session too', () => {
    const g = buildCategoryTree(snapshot, sessions, view, ['s-pinned'], [], true)
    assert.deepEqual(flat(g).loose, ['s-loose'])
  })

  console.log('hoist off')
  test_('the pinned session stays in its category', () => {
    const g = buildCategoryTree(snapshot, sessions, view, ['s-pinned'], [], false)
    const f = flat(g)
    assert.deepEqual(f.pinned, [])
    assert.deepEqual(f.alpha, ['s-pinned', 's-plain'])
  })

  test_('the global pinned section is empty', () => {
    const g = buildCategoryTree(snapshot, sessions, view, ['s-pinned'], [], false)
    assert.deepEqual(g.pinnedSessions, [])
  })

  console.log('no pin at all')
  test_('nothing is hoisted and the tree is unchanged', () => {
    const on = flat(buildCategoryTree(snapshot, sessions, view, [], [], true))
    const off = flat(buildCategoryTree(snapshot, sessions, view, [], [], false))
    assert.deepEqual(on, off)
    // Nothing is pinned, so the row named 's-pinned' is just a session
    // that stays in its category under both settings.
    assert.deepEqual(on.alpha, ['s-pinned', 's-plain'])
  })

  console.log(results.join('\n'))
  const passed = results.filter((r) => r.startsWith('  ok')).length
  console.log(passed + ' passed, ' + (results.length - passed) + ' failed')
  console.log('PIN_HOIST_TEST_DONE')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
