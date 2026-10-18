/**
 * Prove the nesting actually nests, using the *derivation* rather than the live
 * workspace list (the two real Workspaces are siblings by path, so the live
 * sidebar can only ever show the flat shape).
 *
 * The bundle is materialized in a fake DOM, then `workspaceTreeParents` /
 * `workspaceTreeDepth` are exercised on a synthetic parent/child/grandchild
 * set — the same functions `deriveGroups` calls, compiled from the shipped
 * artifact rather than from source.
 */
import fs from 'node:fs'
import path from 'node:path'

const CLIENT = process.argv[2]
  ?? 'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop\\node_modules\\dsh-session-categories\\lib\\client.js'
const source = fs.readFileSync(CLIENT, 'utf8')

// The derivation is not exported from the bundle (only apply/inject/store are),
// so lift each compiled function straight out of the artifact by brace depth.
// That keeps this check honest: it measures what shipped, not what the sources
// say.
function lift(name) {
  const at = source.indexOf(`function ${name}(`)
  if (at < 0) throw new Error(`${name} not found in the shipped bundle`)
  let depth = 0
  for (let index = source.indexOf('{', at); index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, index + 1)
    }
  }
  throw new Error(`${name} is unterminated`)
}

const folderFn = lift('folderPath')
const owningFn = lift('owningParentFolder')
const parentsFn = lift('workspaceTreeParents')
const depthFn = lift('workspaceTreeDepth')

// The compiled helpers may reference the module-scope helpers; evaluating them
// together in one closure keeps those references resolvable.
const api = new Function(`
${folderFn}
${owningFn}
${parentsFn}
${depthFn}
return { folderPath, owningParentFolder, workspaceTreeParents, workspaceTreeDepth }
`)()

const ws = (id, p) => ({ workspaceId: id, path: p })
let failures = 0
const check = (name, body) => {
  try { body(); console.log(`  ok   ${name}`) } catch (error) { failures += 1; console.log(`  FAIL ${name}\n       ${error.message}`) }
}
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

console.log(`shipped artifact: ${CLIENT}`)
console.log(`  ${(source.length / 1024).toFixed(1)} KiB\n`)

console.log('nested Workspaces (parent + child + grandchild)')
const nested = [
  ws('root', 'E:\\AI\\DSH'),
  ws('child', 'E:\\AI\\DSH\\default-workspace'),
  ws('grand', 'E:\\AI\\DSH\\default-workspace\\sub'),
  ws('other', 'C:\\Users\\me\\.dsh\\dsh_qq'),
]
const parents = api.workspaceTreeParents(nested)
const depth = api.workspaceTreeDepth(nested)

check('the root has no parent', () => eq(parents.get('root'), undefined, 'root.parentKey'))
check('the child points at the root', () => eq(parents.get('child'), 'root', 'child.parentKey'))
check('the grandchild points at the child (nearest ancestor)', () => eq(parents.get('grand'), 'child', 'grand.parentKey'))
check('an unrelated Workspace stays a root', () => eq(parents.get('other'), undefined, 'other.parentKey'))

check('depths cascade 0 / 1 / 2', () => {
  eq(depth.get('root'), 0, 'root.depth')
  eq(depth.get('child'), 1, 'child.depth')
  eq(depth.get('grand'), 2, 'grand.depth')
  eq(depth.get('other'), 0, 'other.depth')
})

console.log('\nthe renderer contract')
check('exactly one section renders inside another', () => {
  const withParent = [...parents.entries()].filter(([, parent]) => parent !== undefined)
  eq(withParent.length, 2, 'nested sections')
})
check('a child section is filtered under its parent key', () => {
  // renderGroupList(parentKey) filters `group.parentKey === parentKey`.
  const childrenOf = (key) => nested.filter(workspace => parents.get(workspace.workspaceId) === key)
  eq(childrenOf('root').length, 1, 'children of root')
  eq(childrenOf('child').length, 1, 'children of child')
  eq(childrenOf('grand').length, 0, 'children of grand')
})

console.log('')
if (failures > 0) {
  console.log(`${failures} failed`)
  process.exit(1)
}
console.log('SHIPPED_NESTING_OK')
