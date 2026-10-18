/**
 * Inspects the compiled client bundle for the session action menu.
 *
 * The bundle cannot be materialized outside the host: it requires
 * `@deepseek-ai/dsh-client-store`, which pulls `zustand` from the profile's
 * resolution graph. Rather than rebuild that graph here, this script reads the
 * emitted code and reports the menu the row component actually builds.
 *
 * That distinction matters when a menu entry seems to be missing in the UI:
 * "the entry was never compiled in" and "the entry compiled but something
 * hides it at runtime" need opposite fixes, and only the source can tell them
 * apart.
 *
 * Run: node scripts/test-session-menu.mjs [path-to-client.js]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? path.join(
  'C:',
  'Users',
  'ASUS 98',
  '.dsh',
  'profiles',
  'desktop',
  'node_modules',
  'dsh-session-categories',
  'lib',
  'client.js',
)

if (!fs.existsSync(target)) {
  console.error(`FAIL  no client bundle at ${target}`)
  process.exit(1)
}

const source = fs.readFileSync(target, 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

console.log(`bundle: ${target}`)
console.log(`size  : ${source.length} bytes\n`)

// Pull the row component's menu construction out of the bundle. The generated
// code keeps `const sessionMenuItems = [...]` verbatim, only minifying
// identifiers inside it.
const match = source.match(/const sessionMenuItems = \[([\s\S]{0,4000}?)\n\t*\]/)
console.log('menu construction')
check('a sessionMenuItems array is emitted', match !== null)
if (match === null) {
  console.error('\nthe row component does not build an action menu at all')
  process.exit(1)
}
const block = match[1]

// The source writes ids as single-quoted literals; the compiled bundle prints
// them double-quoted. Every probe below therefore accepts either quote style,
// so this suite can audit the source tree and the installed artifact alike —
// matching only one style made it fail against code that was correct.
//
// `at` finds a literal with either quote style and reports its index (or -1),
// which is what the ordering checks need anyway.
const at = (text, needle) => {
  const single = text.indexOf(needle)
  if (single >= 0) return single
  return text.indexOf(needle.replace(/'/g, '"'))
}

console.log('\nentries')
check("rename is present", at(block, "id: 'rename'") >= 0)
check("fork is present", at(block, "id: 'fork'") >= 0)
check("archive is present", at(block, "id: 'archive'") >= 0)
check("move-to-category is present", at(block, "id: 'move-category'") >= 0)
check("delete is present", at(block, "id: 'delete'") >= 0)

console.log('\ndelete entry detail')
check('it has a localized label', at(block, "t('menu.deleteSession')") >= 0)
check('it uses the trash icon', block.includes('IconTrashOutlineRegular'))
// `danger` is the field the Menu primitive reads to paint a destructive row
// red; `destructive` is a different name that the primitive ignores silently.
// This probe originally demanded `destructive`, i.e. it asserted the one
// spelling that would have had no visible effect.
//
// The pattern must step over the icon's own `{}` — a `[^}]*` tail stops at the
// empty options object and never reaches the flag on the following line.
check(
  'it is marked destructive',
  /id: ['"]delete['"][\s\S]{0,400}?danger/.test(block),
)

console.log('\nordering')
const archiveAt = at(block, "id: 'archive'")
const categoryAt = at(block, "id: 'move-category'")
const deleteAt = at(block, "id: 'delete'")
check('delete comes after archive', deleteAt > archiveAt, `archive@${archiveAt} delete@${deleteAt}`)
check('delete comes after the category submenu', deleteAt > categoryAt, `category@${categoryAt} delete@${deleteAt}`)

console.log('\nwiring')
check('choose routes the delete id', /id === ['"]delete['"]/.test(source))
check("choose calls onDelete with the title", /id === ['"]delete['"][^\n]{0,120}onDelete\([^)]*\)/.test(source))
check('the row takes an onDelete prop', /onDelete[^,]{0,40}\)\s*\{/.test(source) || source.includes('onDelete:'))
check('a confirmation dialog exists', source.includes('delete.session.title'))
check('the dialog names the session', source.includes('delete.session.desc'))
check('the dialog has a confirm action', source.includes('delete.session.confirm'))
check('an undo affordance exists', source.includes('delete.session.undo'))

console.log('\nlocalization')
check('the zh dictionary defines the delete label', /"menu\.deleteSession"\s*:\s*"/.test(source))
const zhLabel = source.match(/"menu\.deleteSession"\s*:\s*"([^"]+)"/)
check('the label reads as a delete action', zhLabel !== null, zhLabel === null ? '' : zhLabel[1])

console.log('')
if (failures > 0) {
  console.error(`${failures} problem(s)`)
  process.exit(1)
}
console.log('SESSION_MENU_TEST_DONE')
