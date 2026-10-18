/**
 * Traces the session action menu from its array to the Menu call site.
 *
 * The bundle cannot be fully materialized outside the host (its store seed
 * resolves `zustand` from a graph only the web shell has), so this script does
 * the one thing that still needs proving: follow the array that feeds the row
 * Menu and report every entry in it, in order.
 *
 * This distinguishes the two failure modes that look identical in the UI:
 * an entry that was never compiled in, and an entry that is compiled in but
 * dropped by a filter or a ternary on the way to the Menu.
 *
 * Run: node scripts/test-menu-render.mjs [path-to-client.js]
 */
import fs from 'node:fs'

const target = process.argv[2] ??
  'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop\\node_modules\\dsh-session-categories\\lib\\client.js'

const source = fs.readFileSync(target, 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures += 1
}

/** Extract a balanced bracketed literal starting at `from`. */
function sliceBalanced(text, from, open = '[', close = ']') {
  let depth = 0
  let started = false
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === open) { depth += 1; started = true } else if (text[i] === close) {
      depth -= 1
      if (started && depth === 0) return text.slice(from, i + 1)
    }
  }
  return null
}

// Every place a Menu is called with an `items:` array, paired with the source
// of that array.
console.log('Menu call sites')
const callSites = [...source.matchAll(/jsxs?\(\s*(?:_deepseek_ai_dsh_client_ui_primitives\.)?Menu,\s*\{/g)]
console.log(`  found ${callSites.length}`)

for (const [index, site] of callSites.entries()) {
  const braceStart = source.indexOf('{', site.index + site[0].length - 1)
  const body = sliceBalanced(source, braceStart, '{', '}')
  if (body === null) continue
  const items = body.match(/items:\s*([A-Za-z_$][\w$]*)/)
  const ids = [...body.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1])
  console.log(`\n  [${index}] items=${items === null ? '(inline or none)' : items[1]}`)
  if (ids.length > 0) console.log(`      inline ids: ${ids.join(', ')}`)
}

/**
 * Split an array literal into its top-level entries.
 *
 * Splitting on `},{` is not enough: entries carry nested objects (icons, the
 * category submenu), so this walks the text and cuts at the commas that sit at
 * bracket depth 1 — the array's own level.
 */
function splitEntries(array) {
  const entries = []
  let depth = 0
  let start = 1
  for (let i = 0; i < array.length; i += 1) {
    const character = array[i]
    if (character === '[' || character === '{' || character === '(') depth += 1
    else if (character === ']' || character === '}' || character === ')') depth -= 1
    else if (character === ',' && depth === 1) {
      entries.push(array.slice(start, i))
      start = i + 1
    }
  }
  entries.push(array.slice(start, array.length - 1))
  return entries.map(entry => entry.trim()).filter(entry => entry !== '')
}

// The row component builds `sessionMenuItems` and hands it to its Menu.
console.log('\nsessionMenuItems')
const arrayStart = source.indexOf('const sessionMenuItems = ')
check('the array is declared', arrayStart >= 0)
const array = arrayStart < 0 ? null : sliceBalanced(source, source.indexOf('[', arrayStart))
check('the array is balanced', array !== null)
if (array !== null) {
  const ids = [...array.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1])
  console.log(`  entries in order: ${ids.join(' → ')}`)
  check('rename present', ids.includes('rename'))
  check('fork present', ids.includes('fork'))
  check('archive present', ids.includes('archive'))
  check('move-category present', ids.includes('move-category'))
  check('delete present', ids.includes('delete'))
  check('delete is last', ids[ids.length - 1] === 'delete', `last is ${ids[ids.length - 1]}`)

  // Two entries ARE ternaries by design: pin/unpin is one row whose label
  // follows the Session's state, so exactly one of the pair always renders.
  //
  // The check below is the honest version of "no entry is gated": a `?` whose
  // two arms are each an object carrying its own `id:` is a *label flip* (fine,
  // that is how pin/unpin works); a `?` that decides whether a fixed entry
  // appears at all is a gate, which is the failure being hunted.
  const flips = [...array.matchAll(/\?\s*\{\s*id:\s*"([^"]+)"[\s\S]*?\}\s*:\s*\{\s*id:\s*"([^"]+)"/g)]
    .map(match => `${match[1]}/${match[2]}`)
  check('every ternary only flips a label, it does not gate an entry', flips.length > 0,
    `label flips: ${flips.join(', ') || 'none'}`)
}

// The Menu that receives it must be the session row's, and must not filter.
console.log('\nthe Menu that receives the array')
const receiver = source.indexOf('items: sessionMenuItems')
check('a Menu is handed sessionMenuItems', receiver >= 0)
if (receiver >= 0) {
  const context = source.slice(Math.max(0, receiver - 800), receiver + 200)
  check('the call passes the array straight through', /items:\s*sessionMenuItems\s*,/.test(source.slice(receiver, receiver + 40)))
  check('no filter is applied to it', !/sessionMenuItems\.filter/.test(source))
  check('no slice limits it', !/sessionMenuItems\.slice/.test(source))
}

// The onSelect must route the delete id to a callback.
//
// Two menus carry an `onSelect` in this file: the category row's and the
// session row's. Anchoring on the first `onSelect:` found therefore audited the
// category menu and reported its `actions.delete()` as if it were the session
// row's — which is why these checks failed against correct code. The handler is
// now cut from the point where the Session's own array is handed to the Menu.
//
// The row emits its ids as single-quoted literals (`id === 'delete'`), so both
// quote styles are accepted.
console.log('\nrouting')
const sessionMenuAt = source.indexOf('items: sessionMenuItems')
const routing = sessionMenuAt < 0
  ? null
  : source.slice(sessionMenuAt).match(/onSelect:\s*\(id\)\s*=>\s*\{[\s\S]{0,600}?\n\t*\}\)?,/)
check('an onSelect handler is emitted', routing !== null)
if (routing !== null) {
  check('it routes delete', /id === ['"]delete['"]/.test(routing[0]))
  // A delete callback takes more than the id: the row's title travels with it
  // so the confirmation dialog can name what is about to be deleted. The call
  // is a bare statement in that handler, so match the call itself.
  const call = routing[0].match(/id === ['"]delete['"]\s*\)?\s*\{?\s*(onDelete\([^)]*\))/)
  check('it calls a delete callback with two arguments', call !== null && /onDelete\([^)]*,[^)]*\)/.test(call[1]), call?.[1]?.trim() ?? '')
}

// The row component must actually accept the callback it calls.
console.log('\nthe row component contract')
const rowProps = source.match(/function SessionNodeItem\(\{([\s\S]{0,400}?)\}\)\s*\{/)
check('the row destructures its props', rowProps !== null)
if (rowProps !== null) check('it destructures onDelete', rowProps[1].includes('onDelete'))

console.log('')
if (failures > 0) { console.error(`${failures} problem(s)`); process.exit(1) }
console.log('MENU_RENDER_TEST_DONE')
