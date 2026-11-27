// Builds the Owner Console: ONE self-contained HTML file (all JavaScript and CSS inlined, no external requests
// except the API). Prints the version and the file's SHA-256.
//
//   node owner-console/build.mjs                        -> dist/SMB-Owner-Console-v<version>.html for https://api.smbdigitalx.com
//   node owner-console/build.mjs --api http://127.0.0.1:5055 --out <dir>     (test builds)
//
// No npm packages: Node's own modules only.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const version = pkg.version
const api = (arg('--api') ?? 'https://api.smbdigitalx.com').replace(/\/+$/, '')
const outDir = arg('--out') ?? join(here, 'dist')
const apiOrigin = new URL(api).origin
if (!/^https:\/\//.test(api) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) throw new Error('The API must be https (or a local test address)')

const read = f => readFileSync(join(here, 'src', f), 'utf8').replace(/\r\n/g, '\n')
const words = read('data/eff_large_wordlist.txt').trim().split('\n').map(l => l.split('\t')[1].trim())
if (words.length !== 7776 || new Set(words).size !== 7776) throw new Error('The EFF word list must have 7776 different words')
const common = read('data/common-phrases.txt').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

// crypto.js is an ES module (the tests import it); inside the page it becomes plain code in one scope.
const cryptoCode = read('crypto.js').replace(/^export /gm, '')
// integrity.js imports from crypto.js (for the tests); in the page both share one scope.
const integrityCode = read('integrity.js').replace(/^import .*$/gm, '').replace(/^export /gm, '')
const signatureCode = read('signature.js').replace(/^export /gm, '')
const BUILD = { api, version, words, common }
const script = `(() => {\n'use strict';\nconst BUILD = ${JSON.stringify(BUILD)};\n${cryptoCode}\n${integrityCode}\n${signatureCode}\n${read('screens.js')}\n${read('app.js')}\n})();\n`
const style = read('style.css')
if (/<\/(script|style)/i.test(script + style)) throw new Error('Inline code must not contain a closing script/style tag')

const cspHash = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
const csp = [
    "default-src 'none'",
    `script-src ${cspHash(script)}`,
    `style-src ${cspHash(style)}`,
    `connect-src ${apiOrigin}`,
    'img-src data: blob:',            // the cleaned signature shown before issuing
    "font-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    'frame-src blob:',                // the signed PDF preview, fetched by the console and shown from memory
    "worker-src 'none'",
    "manifest-src 'none'",
].join('; ')

const html = read('index.html')
    .split('__CSP__').join(csp)
    .split('__VERSION__').join(version)
    .split('__STYLE__').join(style)
    .split('__SCRIPT__').join(script)

mkdirSync(outDir, { recursive: true })
const name = `SMB-Owner-Console-v${version}.html`
const file = join(outDir, name)
writeFileSync(file, html, 'utf8')
const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
writeFileSync(join(outDir, `${name}.sha256.txt`), `${sha}  ${name}\n`)
copyFileSync(join(here, 'CONSOLE-PROFILE-GUIDE.md'), join(outDir, 'CONSOLE-PROFILE-GUIDE.md'))

console.log(`Built ${name}`)
console.log(`  version  ${version}`)
console.log(`  API      ${api}`)
console.log(`  size     ${(html.length / 1024).toFixed(0)} KB`)
console.log(`  SHA-256  ${sha}`)
console.log(`  check on Windows:  certutil -hashfile ${name} SHA256`)
