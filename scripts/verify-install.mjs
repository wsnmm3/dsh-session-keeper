/**
 * Confirms the installed plugin is coherent after a restart.
 *
 * Runs the checks that matter to a live install, in the order a failure would
 * surface: the Host module loads, the typert manifest matches it, the client
 * bundle is well formed, and the storage domain file exists (which is the
 * proof the plugin actually mounted rather than merely importing).
 *
 * Run: node scripts/verify-install.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const INSTALL = 'C:\\Users\\ASUS 98\\.dsh\\profiles\\desktop\\node_modules\\dsh-session-categories\\lib'
const STORAGE = 'C:\\Users\\ASUS 98\\.dsh\\storages\\session_categories.json'
const root = join(import.meta.dirname, '..')

const problems = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) problems.push(label)
}

console.log('installed files')
for (const [name, expectMin] of [['index.js', 30000], ['client.js', 300000], ['typert.remote-client.js', 29000], ['spec.js', 0]]) {
  const file = join(INSTALL, name)
  const exists = existsSync(file)
  check(name, exists && statSync(file).size >= expectMin, exists ? `${statSync(file).size} bytes` : 'missing')
}

console.log('\nhost face')
// `spec.js` must stay the two-line re-export the package ships: the full
// implementation lives in `types/spec.js`, and writing it here duplicates a
// module the profile cannot resolve on its own.
const spec = readFileSync(join(INSTALL, 'spec.js'), 'utf8')
check('spec.js is the re-export shim', spec.includes("from './types/spec.js'") && spec.length < 200)

let service
try {
  const loaded = await import(pathToFileURL(join(INSTALL, 'index.js')).href)
  service = loaded.SessionCategoriesService
  check('index.js imports', typeof service === 'function')
} catch (error) {
  check('index.js imports', false, error.message)
}

const hostSource = readFileSync(join(INSTALL, 'index.js'), 'utf8')
for (const method of ['deleteSessions', 'undoDeleteSessions', 'listRecycledSessions', 'sweepRecycledSessions']) {
  check(`host exposes ${method}`, hostSource.includes(`Remote("${method}")`) || hostSource.includes(`Remote('${method}')`))
}
check('host has no retired client-runtime import', !hostSource.includes('dsh-client-runtime'))

console.log('\ntypert manifest')
const manifestSource = readFileSync(join(INSTALL, 'typert.remote-client.js'), 'utf8')
for (const method of ['deleteSessions', 'undoDeleteSessions', 'listRecycledSessions', 'sweepRecycledSessions']) {
  check(`manifest declares ${method}`, manifestSource.includes(`/${method}'`))
}
const descriptorCount = (manifestSource.match(/id: 'dsh-session-categories#/g) ?? []).length
check('manifest descriptor count', descriptorCount === 12, `${descriptorCount} descriptors`)

console.log('\nclient bundle')
const clientSource = readFileSync(join(INSTALL, 'client.js'), 'utf8')
check('client inlines its stylesheet', clientSource.includes('data-plugin-css'))
check('client carries no ESM css import', !/^\s*import\s+['"][^'"]*\.css['"]/m.test(clientSource))
const requires = [...new Set([...clientSource.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]))].sort()
check(
  'client require set is the expected four',
  requires.length === 4 && requires.includes('react') && requires.includes('@deepseek-ai/dsh-client-store'),
  requires.join(', '),
)
check('client has no retired icon names', !/Outline16|Fill14|Outline20/.test(clientSource))
check('client carries the delete verbs', clientSource.includes('deleteSession') && clientSource.includes('undoDelete'))

console.log('\nlive state')
check('storage domain file exists', existsSync(STORAGE), STORAGE)

// The offline suites are the behavioural half of this check, so run them here
// too rather than trusting that they were run separately.
console.log('\noffline suites')
for (const [label, script] of [['recycle unit tests', 'test-recycle.mjs'], ['host service tests', 'test-host-service.mjs']]) {
  try {
    const output = execFileSync(process.execPath, [join(root, 'scripts', script)], { encoding: 'utf8', cwd: root })
    const line = output.trim().split(/\r?\n/).filter(l => l.includes('passed')).pop() ?? 'no summary'
    check(label, output.includes('DONE'), line.trim())
  } catch (error) {
    check(label, false, error.message.split('\n')[0])
  }
}

console.log('')
if (problems.length > 0) {
  console.error(`${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('VERIFY_INSTALL_OK')
