/**
 * Pre-build guard test for `scripts/inline-css.mjs`.
 *
 * That script has two ways to go wrong that a normal build will not reveal:
 *   - it anchors on `var exports = module.exports;` — if the bundler ever
 *     renames or moves that line, the splice throws and the raw ESM
 *     `import './style.css'` survives into the artifact (which the host then
 *     refuses to load);
 *   - it is not idempotent: run twice against an already-inlined bundle it
 *     leaves the second copy of the sheet out (no style.css) but never removes
 *     a stale import.
 *
 * This test runs the script against a throwaway copy of a fake build root and
 * asserts the resulting artifact shape.
 *
 * Run: node scripts/test-inline-css.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'inline-css.mjs')

const PREAMBLE = `
window.__ModuleLoader__.load({
\tid: "dsh-session-keeper",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;

import './style.css'

const value = 1
return value
\t}
});`

/** Fresh fake build root holding one bundle plus one emitted stylesheet. */
function fixture({ withCss = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-css-'))
  fs.mkdirSync(path.join(root, 'lib'))
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(script, path.join(root, 'scripts', 'inline-css.mjs'))
  fs.writeFileSync(path.join(root, 'lib', 'client.js'), PREAMBLE)
  if (withCss) fs.writeFileSync(path.join(root, 'lib', 'style.css'), '.a { color: red }')
  return root
}

const run = (root) => execFileSync(process.execPath, [path.join(root, 'scripts', 'inline-css.mjs')], { encoding: 'utf8' })

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

console.log('inlining')

check('the emitted side-car sheet is folded into the bundle', () => {
  const root = fixture()
  run(root)
  const js = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(js.includes('.a { color: red }'), 'the CSS text must be present in the bundle')
  assert.ok(js.includes('data-plugin-css'), 'the style must be tagged for de-duplication')
  assert.equal(fs.existsSync(path.join(root, 'lib', 'style.css')), false, 'the side-car sheet must be removed')
})

check('the ESM side-effect import is stripped', () => {
  const root = fixture()
  run(root)
  const js = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  assert.equal(/^\s*import\s+['"][^'"]*\.css['"];?\s*$/m.test(js), false, 'a CSS import inside the factory is invalid')
})

check('the injection lands after the factory preamble', () => {
  const root = fixture()
  run(root)
  const js = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  const preamble = js.indexOf('var exports = module.exports;')
  const injection = js.indexOf('Inlined from lib/style.css')
  const body = js.indexOf('const value = 1')
  assert.ok(preamble >= 0 && injection > preamble && body > injection, 'style must install before the module body runs')
})

check('the bundle stays syntactically valid', () => {
  const root = fixture()
  run(root)
  const js = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  assert.doesNotThrow(() => new Function(js.replace('window.__ModuleLoader__.load', '(() => {})')), 'the artifact must parse')
})

console.log('\nedge cases')

check('a build with no emitted stylesheet is a no-op', () => {
  const root = fixture({ withCss: false })
  const before = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
  const out = run(root)
  assert.match(out, /nothing to inline/)
  assert.equal(fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8'), before, 'the bundle must not be touched')
})

check('a missing bundle fails loudly', () => {
  const root = fixture()
  fs.rmSync(path.join(root, 'lib', 'client.js'))
  assert.throws(() => run(root), /missing build output/)
})

check('a moved preamble anchor fails loudly instead of shipping an import', () => {
  const root = fixture()
  fs.writeFileSync(
    path.join(root, 'lib', 'client.js'),
    PREAMBLE.replace('var exports = module.exports;', 'const exports = module.exports;'),
  )
  assert.throws(() => run(root), /could not find the factory preamble/)
})

console.log('')
if (failures.length > 0) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error.stack}`)
  process.exit(1)
}
console.log(`${passed} passed, 0 failed`)
console.log('INLINE_CSS_OK')
