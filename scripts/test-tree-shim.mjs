/**
 * Regression test for `indexSubagentDescendants`.
 *
 * The first version took an array, but every call site passes the Session
 * snapshot's keyed `byId` (or an equivalent map). The mismatch threw
 * "sessions is not iterable" inside `sidebar.workspaces`, which took the whole
 * slot entry down: the sidebar silently fell back to the shipped browser and
 * none of the plugin's rows appeared. This test pins the accepted shapes so a
 * later edit cannot reintroduce the crash — a wrong shape must degrade to an
 * empty index, never to a throw.
 *
 * Run: node scripts/test-tree-shim.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(
  here, '..', 'packages', 'client', 'ui-session-categories', 'src', 'client', 'tree.ts',
)

// The module is TypeScript with workspace-only imports, so it is not loadable
// here. Extract just the function body and evaluate it — enough to exercise the
// shape handling, which is the whole point of this test.
const source = await readFile(sourcePath, 'utf8')
const start = source.indexOf('export function indexSubagentDescendants')
assert.ok(start >= 0, 'indexSubagentDescendants must exist in tree.ts')
const end = source.indexOf('\n}', start)
assert.ok(end > start, 'could not find the function body end')
const body = source.slice(start, end + 2)
  .replace('export function indexSubagentDescendants', 'function indexSubagentDescendants')

// Strip the type annotations the runner would choke on.
const js = body
  .replace(/:\s*Readonly<Record<string,\s*SessionSummary>>\s*\|\s*readonly\s+SessionSummary\[\]\s*\|\s*null\s*\|\s*undefined/g, '')
  .replace(/\)\s*:\s*Map<SessionId,\s*\{\s*runningCount:\s*number\s*\}>/g, ')')
  .replace(/const counts\s*=\s*new Map<SessionId,\s*number>\(\)/g, 'const counts = new Map()')
  .replace(/const list\s*:\s*readonly SessionSummary\[\]/g, 'const list')
  .replace(/\(session\)\s*:\s*session is SessionSummary/g, '(session)')
  .replace(/const indexed\s*=\s*new Map<SessionId,\s*\{\s*runningCount:\s*number\s*\}>\(\)/g, 'const indexed = new Map()')
  .replace(/\(sessions as Record<string,\s*SessionSummary\s*\|\s*undefined>\)/g, '(sessions)')

let indexSubagentDescendants
try {
  indexSubagentDescendants = new Function(`${js}; return indexSubagentDescendants`)()
} catch (error) {
  console.error(`FAIL  could not evaluate the extracted function: ${error.message}`)
  console.error(js)
  process.exit(1)
}

let passed = 0
const failures = []
function check(name, body) {
  try {
    body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** Build one Session summary carrying subagent children. */
function session(id, children = []) {
  return { id, subagents: children }
}

console.log('accepted shapes')
check('a keyed object (the snapshot byId) is accepted', () => {
  const byId = {
    's-1': session('s-1', [{ parentId: 's-1', running: true }]),
    's-2': session('s-2', []),
  }
  const result = indexSubagentDescendants(byId)
  assert.equal(result.get('s-1').runningCount, 1)
})
check('an array is still accepted', () => {
  const result = indexSubagentDescendants([session('s-1', [{ parentId: 's-1', running: true }, { parentId: 's-1', running: true }])])
  assert.equal(result.get('s-1').runningCount, 2)
})
check('undefined degrades to an empty index instead of throwing', () => {
  assert.equal(indexSubagentDescendants(undefined).size, 0)
})
check('an empty object is fine', () => {
  assert.equal(indexSubagentDescendants({}).size, 0)
})

console.log('\ncounting')
check('only running children are counted', () => {
  const result = indexSubagentDescendants({
    's-1': session('s-1', [
      { parentId: 's-1', running: true },
      { parentId: 's-1', running: false },
      { parentId: 's-1' },
    ]),
  })
  assert.equal(result.get('s-1').runningCount, 1)
})
check('children without a parentId are ignored', () => {
  const result = indexSubagentDescendants({
    's-1': session('s-1', [{ running: true }, { parentId: 's-1', running: true }]),
  })
  assert.equal(result.get('s-1').runningCount, 1)
})
check('children with no subagents at all are skipped', () => {
  const result = indexSubagentDescendants({ 's-1': { id: 's-1' }, 's-2': session('s-2', []) })
  assert.equal(result.size, 0)
})
check('a parent with no running children is absent, not zero', () => {
  const result = indexSubagentDescendants({ 's-1': session('s-1', [{ parentId: 's-1', running: false }]) })
  assert.equal(result.has('s-1'), false)
})
check('two parents are tallied independently', () => {
  const result = indexSubagentDescendants({
    'p-1': session('p-1', [{ parentId: 'p-1', running: true }]),
    'p-2': session('p-2', [
      { parentId: 'p-2', running: true },
      { parentId: 'p-2', running: true },
    ]),
  })
  assert.equal(result.get('p-1').runningCount, 1)
  assert.equal(result.get('p-2').runningCount, 2)
})

console.log('\nrobustness')
check('null entries in a keyed map are skipped', () => {
  const result = indexSubagentDescendants({ 's-1': undefined, 's-2': session('s-2', [{ parentId: 's-2', running: true }]) })
  assert.equal(result.get('s-2').runningCount, 1)
})
check('a null snapshot degrades to an empty index', () => {
  assert.equal(indexSubagentDescendants(null).size, 0)
})

console.log('')
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
console.log('TREE_SHIM_OK')
