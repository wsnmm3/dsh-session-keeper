/**
 * Regression test for the "by workspace tree" grouping derivation.
 *
 * The live sidebar only ever shows two sibling Workspaces, so a UI click can
 * never prove the nesting rule. This test pins it instead, at the level the
 * renderer consumes:
 *
 *   - `workspaceTreeParents` answers "who owns this Workspace", which is what
 *     makes a child section render inside its parent rather than next to it;
 *   - `workspaceTreeDepth` answers "how deep is it", which the indentation and
 *     the expand/collapse cascade read.
 *
 * Run: node scripts/test-workspace-tree.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(
  here, '..', 'packages', 'client', 'ui-session-categories', 'src', 'client', 'tree.ts',
)
const source = await readFile(sourcePath, 'utf8')

/** Pull one top-level function out of tree.ts and make it evaluatable. */
function extract(name) {
  let start = source.indexOf(`export function ${name}`)
  if (start < 0) start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} must exist in tree.ts`)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, `could not find the end of ${name}`)
  return source.slice(start, end + 2)
    .replace(`export function ${name}`, `function ${name}`)
    // Type-only syntax this one module uses.
    .replace(/\(value:\s*string\):\s*string/g, '(value)')
    .replace(/:\s*readonly\s+WorkspaceView\[\]/g, '')
    .replace(/\)\s*:\s*ReadonlyMap<string,\s*(?:number|string\s*\|\s*undefined)>/g, ')')
    .replace(/\(path:\s*string,\s*folders:\s*readonly\s+string\[\]\):\s*string\s*\|\s*undefined/g, '(path, folders)')
    .replace(/let owner:\s*string\s*\|\s*undefined/g, 'let owner')
    .replace(/let length = -1/g, 'let length = -1')
    .replace(/let next:\s*string\s*\|\s*undefined/g, 'let next')
    .replace(/const idByFolder\s*=\s*new Map<string,\s*string>\(\)/g, 'const idByFolder = new Map()')
    .replace(/const parents\s*=\s*new Map<string,\s*string\s*\|\s*undefined>\(\)/g, 'const parents = new Map()')
    .replace(/const depth\s*=\s*new Map<string,\s*number>\(\)/g, 'const depth = new Map()')
    .replace(/(\w+\.\w+) as string/g, '$1')
}

const js = [
  extract('folderPath'),
  extract('owningParentFolder'),
  extract('workspaceTreeParents'),
  extract('workspaceTreeDepth'),
  'return { folderPath, owningParentFolder, workspaceTreeParents, workspaceTreeDepth }',
].join('\n')

let folderPath
let owningParentFolder
let workspaceTreeParents
let workspaceTreeDepth
try {
  const api = new Function(js)()
  ;({ folderPath, owningParentFolder, workspaceTreeParents, workspaceTreeDepth } = api)
} catch (error) {
  console.error(`FAIL  could not evaluate the extracted functions: ${error.message}`)
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

const ws = (id, p) => ({ workspaceId: id, path: p })

console.log('path normalization')
check('Windows separators collapse to forward slashes', () => {
  assert.equal(folderPath('E:\\AI\\DSH\\'), 'e:/ai/dsh')
  assert.equal(folderPath('E:/AI/DSH//'), 'e:/ai/dsh')
})
check('case is ignored so Windows paths compare equal', () => {
  assert.equal(folderPath('E:\\AI\\DSH'), folderPath('e:/ai/dsh'))
})
check('a POSIX path keeps its backslashes (they may be filename characters)', () => {
  assert.equal(folderPath('/home/me/a\\b'), '/home/me/a\\b')
})

console.log('\nparent link')
check('siblings have no parent', () => {
  const parents = workspaceTreeParents([ws('a', 'E:\\AI\\DSH\\one'), ws('b', 'E:\\AI\\DSH\\two')])
  assert.equal(parents.get('a'), undefined)
  assert.equal(parents.get('b'), undefined)
})
check('a child folder points at its Workspace parent', () => {
  const parents = workspaceTreeParents([ws('root', 'E:\\AI\\DSH'), ws('child', 'E:\\AI\\DSH\\default-workspace')])
  assert.equal(parents.get('root'), undefined)
  assert.equal(parents.get('child'), 'root')
})
check('a grandchild points at the nearest ancestor, not the root', () => {
  const parents = workspaceTreeParents([
    ws('root', 'E:\\AI'),
    ws('mid', 'E:\\AI\\DSH'),
    ws('leaf', 'E:\\AI\\DSH\\deep'),
  ])
  assert.equal(parents.get('mid'), 'root')
  assert.equal(parents.get('leaf'), 'mid')
})
check('a shared prefix that is not a path boundary is not a parent', () => {
  const parents = workspaceTreeParents([ws('a', 'E:\\AI\\DSH'), ws('b', 'E:\\AI\\DSHX')])
  assert.equal(parents.get('b'), undefined)
})
check('a trailing slash on the parent still nests the child', () => {
  const parents = workspaceTreeParents([ws('root', 'E:\\AI\\DSH\\'), ws('child', 'E:\\AI\\DSH\\x')])
  assert.equal(parents.get('child'), 'root')
})
check('an empty path is nobody\u2019s parent and nobody\u2019s child', () => {
  const parents = workspaceTreeParents([ws('root', ''), ws('child', 'E:\\AI\\DSH')])
  assert.equal(parents.get('child'), undefined)
})
check('duplicate paths do not nest inside each other', () => {
  const parents = workspaceTreeParents([ws('a', 'E:\\AI\\DSH'), ws('b', 'E:\\AI\\DSH')])
  assert.equal(parents.get('a'), undefined)
  assert.equal(parents.get('b'), undefined)
})
check('every Workspace gets an entry', () => {
  const parents = workspaceTreeParents([ws('a', 'E:\\A'), ws('b', 'E:\\B')])
  assert.equal(parents.size, 2)
})

console.log('\ndepth')
check('roots are depth 0', () => {
  const depth = workspaceTreeDepth([ws('root', 'E:\\AI\\DSH'), ws('other', 'E:\\ZZZ')])
  assert.equal(depth.get('root'), 0)
  assert.equal(depth.get('other'), 0)
})
check('a child is depth 1 and a grandchild depth 2', () => {
  const depth = workspaceTreeDepth([
    ws('root', 'E:\\AI\\DSH'),
    ws('child', 'E:\\AI\\DSH\\sub'),
    ws('grand', 'E:\\AI\\DSH\\sub\\deep'),
  ])
  assert.equal(depth.get('child'), 1)
  assert.equal(depth.get('grand'), 2)
})
check('an empty list yields an empty map', () => {
  assert.equal(workspaceTreeDepth([]).size, 0)
})
check('a lone Workspace does not loop', () => {
  assert.equal(workspaceTreeDepth([ws('a', 'E:\\AI\\DSH')]).get('a'), 0)
})

console.log('\nnearest-parent helper')
check('the longest containing folder wins', () => {
  assert.equal(
    owningParentFolder('E:\\AI\\DSH\\deep', ['e:/ai', 'e:/ai/dsh']),
    'e:/ai/dsh',
  )
})
check('the child itself is never its own parent', () => {
  assert.equal(owningParentFolder('E:\\AI\\DSH', ['e:/ai/dsh']), undefined)
})

console.log('')
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
console.log('WORKSPACE_TREE_OK')
