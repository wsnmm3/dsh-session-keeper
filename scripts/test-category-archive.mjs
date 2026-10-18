/**
 * Regression test for `deleteCategory` and its archive step.
 *
 * THE BUG THIS PINS
 * -----------------
 * Deleting a category archives the Sessions it holds first. The archive call
 * used to be `archiveSession(id)` with no options, which the registry REJECTS
 * with `WorkspaceActiveSessionError` for any Session that is merely live. The
 * Host turned that into `archive-failed` and returned early, so:
 *
 *   - the category was never removed, and
 *   - the `pendingArchive` entry it had already written was never cleared.
 *
 * Every retry appended another entry (fresh operationId, so nothing collapsed
 * them), and `recoverPending()` replayed all of them on the next startup —
 * which archived Sessions the user had not asked to archive at all.
 *
 * A second defect lived in the cleanup filter: it dropped only the CURRENT
 * operation's entry, stranding the identical entries left by earlier failures.
 *
 * Checks below drive the real service against a stubbed registry that refuses
 * activity the way the real one does, so a regression fails here instead of in
 * somebody's workspace.
 *
 * Run: node scripts/test-category-archive.mjs [path-to-installed-index.js]
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DEFAULT_INSTALLED =
  'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop\\node_modules\\dsh-session-categories\\lib\\index.js'
const target = process.argv[2] ?? DEFAULT_INSTALLED
if (!existsSync(target)) {
  console.error(`FAIL  no Host module at ${target}\n      build and install the plugin first`)
  process.exit(1)
}

const loaded = await import(pathToFileURL(target).href)
const { SessionCategoriesService, WorkspaceActiveSessionError } = loaded
if (typeof SessionCategoriesService !== 'function') {
  console.error('FAIL  SessionCategoriesService is not exported')
  process.exit(1)
}

let passed = 0
const failures = []
async function check(name, body) {
  try {
    await body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/**
 * A registry stub that behaves like the real one where it matters: archiving a
 * Session listed in `active` throws unless the caller passes `stopActivity`.
 */
function makeRegistry({ active = [] } = {}) {
  const archived = []
  const calls = []
  return {
    archived,
    calls,
    archivedSessionIds: archived,
    get: () => undefined,
    list: () => [],
    async archiveSession(sessionId, options) {
      calls.push({ sessionId, stopActivity: options?.stopActivity === true })
      if (active.includes(sessionId) && options?.stopActivity !== true) {
        throw new WorkspaceActiveSessionError(sessionId, [{ kind: 'turn' }])
      }
      archived.push(sessionId)
    },
    async unarchiveSession(sessionId) {
      const at = archived.indexOf(sessionId)
      if (at >= 0) archived.splice(at, 1)
    },
  }
}

/** Build a service whose storage document is the object handed in. */
function makeService(registry, document) {
  const store = {
    get: () => document,
    async set(next) { document = next },
  }
  const ctx = {
    reflect: { provide: () => {}, set: () => {}, get: () => undefined },
    workspaceRegistry: registry,
    logger: { warn: () => {}, error: () => {} },
    effect: () => () => {},
    on: () => {},
  }
  const service = new SessionCategoriesService(ctx)
  if (service.ctx === undefined) service.ctx = ctx
  // Point the storage seam at our in-memory document without touching Cordis.
  service.requireGlobal = () => store
  return { service, read: () => document }
}

const WORKSPACE = 'ws-test'
const CATEGORY = 'cat-parent'
const CHILD = 'cat-child'

/** A document with a parent category, a child, and one Session in each. */
function makeDocument() {
  return {
    version: 1,
    revision: 1,
    categories: [
      { id: CATEGORY, workspaceId: WORKSPACE, parentId: null, title: '父分类', order: 0 },
      { id: CHILD, workspaceId: WORKSPACE, parentId: CATEGORY, title: '子分类', order: 0 },
    ],
    assignments: [
      { sessionId: 'session-in-parent', categoryId: CATEGORY },
      { sessionId: 'session-in-child', categoryId: CHILD },
    ],
    pendingArchive: [],
  }
}

console.log(`host module: ${target}\n`)

console.log('archiving a category whose Session is live')
{
  const registry = makeRegistry({ active: ['session-in-parent'] })
  const { service, read } = makeService(registry, makeDocument())
  await check('the delete succeeds even though the Session is active', async () => {
    const result = await service.deleteCategory({
      workspaceId: WORKSPACE,
      categoryId: CATEGORY,
      operationId: 'op-1',
      expectedRevision: 1,
    })
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.error ?? {})}`)
  })
  await check('the archive call passes stopActivity', () => {
    assert.ok(registry.calls.length > 0, 'archiveSession was never called')
    assert.ok(registry.calls.every(call => call.stopActivity === true),
      `expected every call to pass stopActivity, saw ${JSON.stringify(registry.calls)}`)
  })
  await check('the category and its child are gone', () => {
    assert.deepEqual(read().categories, [], JSON.stringify(read().categories))
  })
  await check('both Sessions were archived', () => {
    assert.deepEqual([...registry.archived].sort(),
      ['session-in-child', 'session-in-parent'])
  })
  await check('no pending entry survives', () => {
    assert.deepEqual(read().pendingArchive, [], JSON.stringify(read().pendingArchive))
  })
  await check('every assignment is dropped', () => {
    assert.deepEqual(read().assignments, [])
  })
}

console.log('\nretry after an earlier failure')
{
  const registry = makeRegistry({ active: [] })
  const document = makeDocument()
  // Simulate the exact wreckage the old code left behind: identical entries from
  // earlier failed attempts, all pointing at the category being deleted now.
  document.pendingArchive = [
    { operationId: 'op-old-1', categoryIds: [CATEGORY], sessionIds: ['session-in-parent'] },
    { operationId: 'op-old-2', categoryIds: [CATEGORY], sessionIds: ['session-in-parent'] },
    { operationId: 'op-unrelated', categoryIds: ['cat-other'], sessionIds: ['session-elsewhere'] },
  ]
  const { service, read } = makeService(registry, document)
  await check('a successful delete clears the stranded entries too', async () => {
    const result = await service.deleteCategory({
      workspaceId: WORKSPACE,
      categoryId: CATEGORY,
      operationId: 'op-new',
      expectedRevision: 1,
    })
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.error ?? {})}`)
    const left = read().pendingArchive
    assert.deepEqual(left.map(item => item.operationId), ['op-unrelated'],
      `only the unrelated entry should remain, saw ${JSON.stringify(left.map(i => i.operationId))}`)
  })
}

console.log('\na deletion that cannot finish')
{
  // An unknown Session is skipped (not an error); a broken registry is.
  const registry = makeRegistry({ active: [] })
  registry.archiveSession = async () => { throw new Error('storage fault') }
  const { service, read } = makeService(registry, makeDocument())
  await check('a storage fault reports archive-failed instead of throwing', async () => {
    const result = await service.deleteCategory({
      workspaceId: WORKSPACE,
      categoryId: CATEGORY,
      operationId: 'op-boom',
      expectedRevision: 1,
    })
    assert.equal(result.ok, false, 'expected a failure result')
    assert.equal(result.error.code, 'archive-failed')
  })
  await check('the category survives so the user can retry', () => {
    assert.equal(read().categories.length, 2, JSON.stringify(read().categories))
  })
  await check('the pending entry is kept for the next recovery pass', () => {
    const ids = read().pendingArchive.map(item => item.operationId)
    assert.ok(ids.includes('op-boom'), `expected op-boom in ${JSON.stringify(ids)}`)
  })
}

console.log('')
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
console.log('CATEGORY_ARCHIVE_OK')
