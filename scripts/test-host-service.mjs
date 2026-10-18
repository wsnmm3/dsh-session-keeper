/**
 * Drives the *built* Host module's recycle methods against a synthetic dsh home.
 *
 * The unit tests in `test-recycle.mjs` prove the recycle layer. This harness
 * proves the layer above it: that the Host module — the file the harness will
 * actually load — exposes `deleteSessions`, `undoDeleteSessions`,
 * `listRecycledSessions`, and `sweepRecycledSessions`, and that calling them
 * moves and restores a log end to end.
 *
 * The module is imported from its *installed* location rather than from this
 * build tree, because the Host face resolves `@deepseek-ai/*` through the
 * profile's node_modules. Pointing the import at the installed copy is what
 * makes the resolution match the real loading path; importing the same file
 * out of `sc-build/lib` cannot resolve those packages at all.
 *
 * The service is instantiated without Cordis: the methods under test touch the
 * filesystem and the globals they are handed, and `deleteSessions` only reaches
 * for `ctx.workspaceRegistry` when a Workspace is named, so a minimal stub is
 * enough to exercise the real code path.
 *
 * DSH_HOME is redirected to a temporary directory for the whole run, so no
 * real Session log is ever in scope.
 *
 * Run: node scripts/test-host-service.mjs [path-to-installed-index.js]
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

const home = await mkdtemp(join(tmpdir(), 'host-service-'))
process.env.DSH_HOME = home

const CONTAINER = '--E-AI-DSH-DSH-Workspace-deepseek-harness-default-workspace--'
const SESSION = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

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

console.log(`synthetic dsh home: ${home}`)

let ServiceClass
try {
  const loaded = await import(pathToFileURL(target).href)
  ServiceClass = loaded.SessionCategoriesService
} catch (error) {
  // The Host face resolves dsh packages through the profile; make a resolution
  // failure explicit rather than reporting every later check as broken.
  console.error(`FAIL  could not import ${target}: ${error.message}`)
  process.exit(1)
}

await check('the built module exports the service class', () => {
  assert.equal(typeof ServiceClass, 'function', 'SessionCategoriesService must be exported')
})

// Instantiate without Cordis. `super(ctx, name)` registers the service on the
// context's reflect layer, so the stub has to carry a `reflect.provide` — that
// is the whole of what the constructor touches. The recycle methods read only
// `this.ctx.workspaceRegistry` and never the storage domain, which is why a
// stub context is faithful for these four methods.
const ctx = {
  reflect: {
    provide: () => {},
    set: () => {},
    get: () => undefined,
  },
  workspaceRegistry: {
    get: () => undefined,
    list: () => [],
    archivedSessionIds: [],
  },
  logger: { warn: () => {} },
  effect: () => () => {},
  on: () => {},
}
const service = new ServiceClass(ctx)
// Cordis stores the context on the instance during `super()`; when the reflect
// stub is inert the property can be missing, and the recycle methods need it.
if (service.ctx === undefined) service.ctx = ctx

await check('every recycle method is exposed on the instance', () => {
  for (const method of ['deleteSessions', 'undoDeleteSessions', 'listRecycledSessions', 'sweepRecycledSessions']) {
    assert.equal(typeof service[method], 'function', `${method} must be callable`)
  }
})

console.log('\nseeding a session log')
await mkdir(join(home, 'sessions', CONTAINER, SESSION), { recursive: true })
await writeFile(join(home, 'sessions', CONTAINER, SESSION, 'session.v4.jsonl.zstd'), Buffer.alloc(2048, 3))

let batchId
await check('deleteSessions moves the log into the recycle bin', async () => {
  const result = await service.deleteSessions({ sessionIds: [SESSION], reason: 'host-service-test' })
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.error ?? {})}`)
  batchId = result.value.batchId
  assert.equal(result.value.reclaimedBytes, 2048)
  assert.deepEqual(result.value.sessionIds, [SESSION])
  const gone = await stat(join(home, 'sessions', CONTAINER, SESSION)).then(() => true).catch(() => false)
  assert.equal(gone, false, 'the live path must be empty after a delete')
})

await check('listRecycledSessions reports the batch', async () => {
  const result = await service.listRecycledSessions()
  assert.equal(result.ok, true)
  assert.equal(result.value.batches.length, 1)
  assert.equal(result.value.batches[0].batchId, batchId)
  assert.deepEqual(result.value.batches[0].sessionIds, [SESSION])
  assert.equal(result.value.batches[0].bytes, 2048)
})

await check('undoDeleteSessions restores the log to its origin', async () => {
  const result = await service.undoDeleteSessions({})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.restored, [SESSION])
  assert.deepEqual(result.value.failed, [])
  const back = await stat(join(home, 'sessions', CONTAINER, SESSION, 'session.v4.jsonl.zstd'))
  assert.equal(back.size, 2048, 'the payload must survive the round trip')
})

await check('the bin is empty after the undo', async () => {
  const result = await service.listRecycledSessions()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.batches, [])
})

await check('undo with nothing pending reports no-batch rather than throwing', async () => {
  const result = await service.undoDeleteSessions({})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no-batch')
})

await check('deleting an unknown session reports the Host code', async () => {
  const result = await service.deleteSessions({ sessionIds: ['session-not-here'] })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'session-log-not-found')
  assert.equal(result.error.sessionId, 'session-not-here')
})

await check('sweepRecycledSessions reclaims an expired batch', async () => {
  await service.deleteSessions({ sessionIds: [SESSION] })
  const swept = await service.sweepRecycledSessions({ maxAgeDays: 0 })
  assert.equal(swept.ok, true)
  assert.equal(swept.value.removedBatchIds.length, 1)
  assert.ok(swept.value.reclaimedBytes >= 2048, `expected >=2048 reclaimed, saw ${swept.value.reclaimedBytes}`)
  const left = await readdir(join(home, 'trash')).catch(() => [])
  assert.deepEqual(left, [], 'the bin directory must be empty after a full sweep')
})

await rm(home, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log('HOST_SERVICE_TEST_DONE')
