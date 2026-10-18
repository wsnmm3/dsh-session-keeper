/**
 * Exercises the recycle module against a synthetic dsh home.
 *
 * Every assertion here runs on fabricated Session logs in a temporary
 * directory: no real `~/.dsh/sessions` tree is read, moved, or removed. That
 * separation is the whole point of the test — the deletion path rewrites a
 * user's conversation history, so its logic has to be proven somewhere the
 * blast radius is zero.
 *
 * Run: node scripts/test-recycle.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encodeWorkspacePath,
  listBatches,
  locateSession,
  recycleSessions,
  restoreBatch,
  sweepTrash,
} from '../packages/workspace/session-categories/src/recycle.ts'

const WORKSPACE = 'E:\\AI\\DSH\\DSH-Workspace\\deepseek-harness\\default-workspace'
const CONTAINER = encodeWorkspacePath(WORKSPACE)

let passed = 0
const failures = []

/** Run one named check, recording rather than throwing so every case reports. */
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

/** Lay down one stored Session with a plausible payload. */
async function seedSession(dshHome, container, sessionId, bytes = 512) {
  const dir = join(dshHome, 'sessions', container, sessionId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), Buffer.alloc(bytes, 7))
  return dir
}

const home = await mkdtemp(join(tmpdir(), 'recycle-test-'))

console.log(`synthetic dsh home: ${home}`)
console.log(`workspace container: ${CONTAINER}\n`)

console.log('encoding')
await check('workspace path encodes the way the harness names containers', () => {
  assert.equal(CONTAINER, '--E-AI-DSH-DSH-Workspace-deepseek-harness-default-workspace--')
})
await check('a space becomes ~0020', () => {
  assert.equal(encodeWorkspacePath('C:\\Users\\ASUS 98\\.dsh\\x'), '--C-Users-ASUS~002098-.dsh-x--')
})

console.log('\nlocation')
const S1 = 'session-11111111-1111-1111-1111-111111111111'
const S2 = 'session-22222222-2222-2222-2222-222222222222'
await seedSession(home, CONTAINER, S1, 1024)
await seedSession(home, CONTAINER, S2, 2048)

await check('locates a session inside its container', async () => {
  const hits = await locateSession(S1, home)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].container, CONTAINER)
})
await check('a missing session yields no hits rather than throwing', async () => {
  assert.deepEqual(await locateSession('session-deadbeef', home), [])
})
await check('the same session resolves under a second container spelling', async () => {
  const other = '--E-AI-DSH-DSH-Data-.dsh-x--'
  await seedSession(home, other, 'session-33333333-3333-3333-3333-333333333333')
  const hits = await locateSession('session-33333333-3333-3333-3333-333333333333', home)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].container, other)
})

console.log('\ndelete')
let firstBatch
await check('deleting moves the log out of the live tree', async () => {
  const result = await recycleSessions({ sessionIds: [S1], workspaceId: 'ws-1', workspacePath: WORKSPACE }, home)
  assert.equal(result.ok, true)
  firstBatch = result.batch
  assert.equal(await stat(join(home, 'sessions', CONTAINER, S1)).then(() => true).catch(() => false), false)
})
await check('the manifest records origin and byte size', async () => {
  const entry = firstBatch.entries[0]
  assert.equal(entry.sessionId, S1)
  assert.equal(entry.container, CONTAINER)
  assert.equal(entry.origin, join(home, 'sessions', CONTAINER, S1))
  assert.equal(entry.sizeBytes, 1024)
  assert.equal(entry.workspaceId, 'ws-1')
})
await check('the payload survives inside the bin', async () => {
  const kept = join(home, 'trash', firstBatch.batchId, CONTAINER, S1, 'session.v4.jsonl.zstd')
  assert.equal((await stat(kept)).size, 1024)
})
await check('a second delete produces a separate batch', async () => {
  const result = await recycleSessions({ sessionIds: [S2] }, home)
  assert.equal(result.ok, true)
  assert.notEqual(result.batch.batchId, firstBatch.batchId)
  assert.equal((await listBatches(home)).length, 2)
})
await check('deleting an unknown session reports failure instead of pretending', async () => {
  const result = await recycleSessions({ sessionIds: ['session-nope'] }, home)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'session-log-not-found')
})

console.log('\nundo')
await check('undo restores the most recent batch to its exact origin', async () => {
  const result = await restoreBatch({}, home)
  assert.equal(result.ok, true)
  assert.deepEqual(result.restored, [S2])
  assert.deepEqual(result.failed, [])
  assert.equal((await stat(join(home, 'sessions', CONTAINER, S2))).isDirectory(), true)
})
await check('unless told otherwise undo leaves older batches alone', async () => {
  const batches = await listBatches(home)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].batchId, firstBatch.batchId)
})
await check('undo by explicit batch id restores the older one too', async () => {
  const result = await restoreBatch({ batchId: firstBatch.batchId }, home)
  assert.equal(result.ok, true)
  assert.deepEqual(result.restored, [S1])
  assert.equal((await stat(join(home, 'sessions', CONTAINER, S1))).isDirectory(), true)
})
await check('the bin is empty once everything is restored', async () => {
  assert.deepEqual(await listBatches(home), [])
})
await check('undo with nothing to undo reports no-batch', async () => {
  const result = await restoreBatch({}, home)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no-batch')
})

console.log('\nundo conflicts')
await check('an occupied origin is reported, not overwritten', async () => {
  const S3 = 'session-44444444-4444-4444-4444-444444444444'
  await seedSession(home, CONTAINER, S3, 64)
  const deleted = await recycleSessions({ sessionIds: [S3] }, home)
  assert.equal(deleted.ok, true)
  // A fresh session claims the same path before the undo runs.
  await seedSession(home, CONTAINER, S3, 64)
  const result = await restoreBatch({}, home)
  assert.equal(result.ok, true)
  assert.deepEqual(result.restored, [])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].reason, 'origin-occupied')
  // The batch survives so the user can retry after clearing the conflict.
  assert.equal((await listBatches(home)).length, 1)
  await rm(join(home, 'sessions', CONTAINER, S3), { recursive: true, force: true })
  await restoreBatch({}, home)
  assert.deepEqual(await listBatches(home), [])
})

console.log('\nretention')
await check('a batch older than the age limit is swept', async () => {
  const S4 = 'session-55555555-5555-5555-5555-555555555555'
  await seedSession(home, CONTAINER, S4, 4096)
  const deleted = await recycleSessions({ sessionIds: [S4] }, home)
  assert.equal(deleted.ok, true)
  const swept = await sweepTrash({ maxAgeDays: 0 }, home)
  assert.equal(swept.removedBatches.length, 1)
  // The reclaim figure covers the whole batch directory, so it includes the
  // manifest alongside the relocated log rather than the log alone.
  assert.ok(
    swept.reclaimedBytes >= 4096,
    `expected at least the 4096-byte log, got ${swept.reclaimedBytes}`,
  )
  assert.deepEqual(await listBatches(home), [])
})
await check('the batch-count limit keeps only the newest', async () => {
  for (let index = 0; index < 3; index += 1) {
    const id = `session-6666666${index}-6666-6666-6666-66666666666${index}`
    await seedSession(home, CONTAINER, id, 32)
    await recycleSessions({ sessionIds: [id] }, home)
  }
  const before = (await listBatches(home)).length
  assert.equal(before, 3)
  const swept = await sweepTrash({ maxBatches: 1, maxAgeDays: 3650 }, home)
  assert.equal(swept.removedBatches.length, 2)
  assert.equal((await listBatches(home)).length, 1)
})

console.log('\nrobustness')
await check('a corrupt manifest does not hide readable batches', async () => {
  const dir = join(home, 'trash', 'broken-batch')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), '{ this is not json', 'utf8')
  const batches = await listBatches(home)
  assert.equal(batches.length, 1, 'the one good batch must still be reported')
})
await check('a missing sessions root is handled without throwing', async () => {
  const bare = await mkdtemp(join(tmpdir(), 'recycle-bare-'))
  assert.deepEqual(await locateSession(S1, bare), [])
  assert.deepEqual(await listBatches(bare), [])
  await rm(bare, { recursive: true, force: true })
})

await rm(home, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log('RECYCLE_TEST_DONE')
