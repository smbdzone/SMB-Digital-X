/*
 * Owner Console application. Built into one HTML file together with crypto.js (see build.mjs), which provides
 * the crypto functions used here. BUILD (API base URL, version, word list, common phrases) is injected at build.
 * All page content is built with DOM calls (never innerHTML with data), so nothing from the server can inject code.
 */
/* global BUILD */

const API = BUILD.api
const IDLE_MS = (() => {
    // Tests may shorten (never lengthen) the idle time: #idle=<seconds>
    const m = /(?:^|[#&])idle=(\d+)/.exec(location.hash)
    const fifteen = 15 * 60_000
    return m ? Math.min(fifteen, Math.max(1, Number(m[1])) * 1000) : fifteen
})()
const PIN_KEY = 'smb-owner-console-pin-v1'

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const S = {
    status: null,         // GET /owner/status
    signingKey: null,     // CryptoKey, not extractable; only while unlocked
    vaultKey: null,
    publicKey: null,      // SPKI base64 of the unlocked key
    fingerprint: null,
    clockOffset: 0,       // server time - laptop time
    tab: 'payroll',
    idleTimer: null,
    lockedReason: '',
}

/* ------------------------------------------------------------------ */
/* Tiny DOM helper                                                     */
/* ------------------------------------------------------------------ */

const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue
        if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
        else if (k === 'class') el.className = v
        else if (k === 'text') el.textContent = v
        else el.setAttribute(k, v === true ? '' : v)
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c))
    return el
}
const app = () => document.getElementById('app')
const show = (...nodes) => { const a = app(); a.replaceChildren(...nodes.filter(x => x !== null && x !== undefined && x !== false)); const f = a.querySelector('[autofocus]'); if (f) f.focus() }
const field = (label, input) => [h('label', { for: input.id, text: label }), input]
const pw = (id, extra = {}) => h('input', { id, type: 'password', autocomplete: 'off', spellcheck: 'false', ...extra })
const txt = (id, extra = {}) => h('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', ...extra })
const alertBox = (kind, title, ...body) => h('div', { class: `alert ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, title ? h('h3', { text: title }) : null, ...body)
const busy = async (button, label, fn) => {
    const old = button.textContent
    button.disabled = true
    button.textContent = label
    try { return await fn() } finally { button.disabled = false; button.textContent = old }
}
const fmtDate = d => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const fmtMoney = (n, cur) => `${cur ?? ''} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/* ------------------------------------------------------------------ */
/* Remembered values on this laptop (not secret; used to spot changes) */
/* ------------------------------------------------------------------ */

const readPin = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null') } catch { return null } }
const writePin = patch => { const p = { ...(readPin() || {}), ...patch, updatedAt: new Date().toISOString() }; localStorage.setItem(PIN_KEY, JSON.stringify(p)); return p }

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }

const api = async (method, path, { body, sign, attachment, raw } = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body)
    const headers = {}
    if (text) headers['Content-Type'] = 'application/json'
    // An attachment (signature image, logo) goes next to the signed text; the signed text names its SHA-256.
    let sendText = text
    if (attachment) { headers['X-Owner-Attachment'] = '1'; headers['Content-Type'] = 'application/json'; sendText = JSON.stringify({ signed: text, attachment: toB64(attachment) }) }
    const key = sign === true ? S.signingKey : sign
    if (key) {
        const sig = await signRequest(key, { method, path, body: text, ts: Date.now() + S.clockOffset })
        headers['X-Owner-Ts'] = sig['X-Owner-Ts']; headers['X-Owner-Nonce'] = sig['X-Owner-Nonce']; headers['X-Owner-Sig'] = sig['X-Owner-Sig']
    }
    let res
    try {
        res = await fetch(API + path, { method, headers, body: sendText || undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' })
    } catch {
        throw new ApiError(0, `Cannot reach ${API}. Check the internet connection and try again.`)
    }
    if (raw && res.ok) return res.blob()
    let json = null
    try { json = await res.json() } catch { /* empty */ }
    if (!res.ok) throw new ApiError(res.status, json?.message || `The server answered ${res.status}.`)
    return json?.data
}

/* ------------------------------------------------------------------ */
/* Auto-lock                                                           */
/* ------------------------------------------------------------------ */

const lock = (reason = '') => {
    S.signingKey = null
    S.vaultKey = null
    S.lockedReason = reason
    if (typeof dropSignature === 'function') dropSignature()   // the one-time signature never outlives the session
    clearTimeout(S.idleTimer)
    S.idleTimer = null
    for (const input of document.querySelectorAll('input')) input.value = ''
    document.getElementById('sheet').replaceChildren()
    boot()
}
const touch = () => {
    if (!S.signingKey) return
    clearTimeout(S.idleTimer)
    S.idleTimer = setTimeout(() => lock(`Locked after ${Math.round(IDLE_MS / 60000) || '<1'} minute(s) without activity.`), IDLE_MS)
}
for (const ev of ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll']) addEventListener(ev, touch, { passive: true, capture: true })
// Closing or leaving the tab: drop the keys.
addEventListener('pagehide', () => { S.signingKey = null; S.vaultKey = null })

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

const boot = async () => {
    show(h('p', { class: 'muted', text: 'Contacting the server…' }))
    let st
    try {
        st = await api('GET', '/api/owner/status')
    } catch (e) {
        return show(alertBox('bad', 'Cannot reach the server', h('p', { text: e.message })), h('button', { on: { click: boot } }, 'Try again'))
    }
    S.status = st
    S.clockOffset = st.serverTime - Date.now()
    const pin = readPin()
    if (!st.setUp) return st.setupWindowOpen ? setupStart() : windowClosed()
    if (!pin?.fingerprint) return firstVisitChoice()
    if (pin.fingerprint !== st.fingerprint) return keyChanged(pin.fingerprint, st.fingerprint)
    return loginScreen()
}

const windowClosed = () => show(
    h('h1', { text: 'Owner Console: not set up yet' }),
    h('div', { class: 'panel' },
        h('p', { text: 'Setup is closed right now.' }),
        h('p', { class: 'muted', text: 'Setup is done once, with you present: the developer opens a short setup window just before. Ask them to open it, then press "Check again".' }),
        h('button', { on: { click: boot } }, 'Check again')),
)

/** Set up, but never on this laptop's console: either another laptop/profile, or someone else did the setup. */
const firstVisitChoice = () => show(
    h('h1', { text: 'This console is already set up' }),
    h('div', { class: 'panel' },
        h('p', { text: 'The server says the Owner Console was set up before, but this console file has not been used on this computer yet.' }),
        h('p', {}, 'Key fingerprint on the server: ', h('span', { class: 'fp small', text: S.status.fingerprint })),
        h('div', { class: 'row' },
            h('button', { on: { click: () => loginScreen() } }, 'I set it up before: log in'),
            h('button', { class: 'danger', on: { click: () => incident('first-visit') } }, 'This is my first time'))),
)

const incident = kind => show(
    alertBox('bad', 'STOP: someone else set up the Owner Console',
        h('p', { text: kind === 'first-visit' || kind === 'setup-409'
            ? 'You have never set up the Owner Console, but the server says it is already set up. Someone else completed the setup, so their key controls the owner actions, not yours.'
            : 'The server refused the setup because it was already done.' }),
        h('p', {}, 'Key fingerprint on the server (not yours): ', h('span', { class: 'fp small', text: S.status?.fingerprint ?? 'unknown' })),
        h('p', { text: 'Do not continue. Do not type your passphrase. Write down this fingerprint and the time, and treat this as a security incident.' })),
    h('button', { class: 'secondary', on: { click: boot } }, 'Back'),
)

const keyChanged = (pinned, server) => show(
    alertBox('bad', 'WARNING: the owner key on the server has changed',
        h('p', { text: 'The key the server presents is not the one this console remembers. Someone replaced the owner key on the server.' }),
        h('p', {}, 'Remembered: ', h('span', { class: 'fp small', text: pinned })),
        h('p', {}, 'Server now: ', h('span', { class: 'fp small', text: server ?? 'none' })),
        h('p', { text: 'Compare with your printed recovery sheet. Do not type your passphrase. Treat this as a security incident.' })),
    h('details', {}, h('summary', { class: 'muted small', text: 'Advanced' }),
        h('p', { class: 'small muted', text: 'Only if the remembered value is wrong (for example after restoring this laptop) and the server fingerprint matches your printed sheet:' }),
        h('button', { class: 'secondary', on: { click: () => { localStorage.removeItem(PIN_KEY); boot() } } }, 'Forget the remembered values on this computer')),
)

/* ------------------------------------------------------------------ */
/* Passphrase input with rules and suggestions                         */
/* ------------------------------------------------------------------ */

const passphraseFields = (prefix) => {
    const p1 = pw(`${prefix}-1`, { autofocus: true }), p2 = pw(`${prefix}-2`)
    const meter = h('div', { class: 'meter' }, h('span'), h('span'), h('span'), h('span'))
    const hint = h('p', { class: 'small muted', text: `At least ${MIN_CHARS} characters, or at least ${MIN_WORDS} words. Not a well-known phrase.` })
    const suggestion = h('div', { class: 'suggest', hidden: true, id: `${prefix}-suggestion` })
    const update = () => {
        const r = checkPassphrase(p1.value, BUILD.common)
        meter.className = `meter s${p1.value ? r.strength : 0}`
        hint.textContent = p1.value ? r.message : `At least ${MIN_CHARS} characters, or at least ${MIN_WORDS} words. Not a well-known phrase.`
        hint.className = `small ${p1.value && !r.ok ? 'bad' : 'muted'}`
    }
    p1.addEventListener('input', update)
    const suggestBtn = h('button', { class: 'secondary', type: 'button', id: `${prefix}-suggest`, on: { click: () => {
        const phrase = suggestPassphrase(BUILD.words, 5)
        suggestion.hidden = false
        suggestion.replaceChildren(h('div', { text: phrase }), h('p', { class: 'small muted', text: 'Five random words (about 64 bits). Learn it by heart. It is written into the first box; type it yourself in the second box.' }))
        p1.value = phrase; p2.value = ''; update(); p2.focus()
    } } }, 'Suggest a passphrase')
    const node = h('div', {}, ...field('New passphrase', p1), meter, hint, suggestBtn, suggestion, ...field('Type it again', p2))
    const read = () => {
        const r = checkPassphrase(p1.value, BUILD.common)
        if (!r.ok) throw new Error(r.message)
        if (p1.value !== p2.value) throw new Error('The two passphrases are not the same.')
        return p1.value
    }
    return { node, read }
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

const steps = n => h('p', { class: 'steps' }, ...['Website login', 'Passphrase', 'Recovery sheet', 'Check', 'Done']
    .map((s, i) => [i ? ' / ' : '', i + 1 === n ? h('b', { text: `${i + 1}. ${s}` }) : `${i + 1}. ${s}`]).flat())

const setup = {}   // in memory during setup only

const setupStart = () => {
    const email = h('input', { id: 'setup-email', type: 'email', autocomplete: 'off', autofocus: true })
    const pass = pw('setup-password')
    const err = h('div')
    const go = h('button', { id: 'setup-check', on: { click: () => busy(go, 'Checking…', async () => {
        err.replaceChildren()
        try {
            const r = await api('POST', '/api/owner/setup/check', { body: { email: email.value, password: pass.value } })
            setup.email = email.value; setup.password = pass.value
            setupEmailCheck(r.reportTo)
        } catch (e) {
            if (e.status === 409) return incident('setup-409')
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.status === 403 ? 'The setup window is closed. Ask the developer to open it.' : e.message })))
        }
    }) } }, 'Continue')
    show(h('h1', { text: 'Set up the Owner Console' }), steps(1),
        h('div', { class: 'panel' },
            h('p', { text: 'First, sign in with your website account. This binds the console to your owner account. Your website password is used only for this one setup request.' }),
            ...field('Website email', email), ...field('Website password', pass), h('p'), err, go))
}

const setupEmailCheck = masked => show(h('h1', { text: 'Set up the Owner Console' }), steps(1),
    h('div', { class: 'panel' },
        h('p', {}, 'A test email was sent to your private address ', h('b', { class: 'mono', text: masked }), '.'),
        h('p', { text: 'Open that mailbox now. Did the "Owner Console: test email" arrive (check spam too)?' }),
        h('div', { class: 'row' },
            h('button', { id: 'email-yes', on: { click: setupPassphrase } }, 'Yes, it arrived'),
            h('button', { class: 'secondary', on: { click: () => show(alertBox('bad', 'Stop here', h('p', { text: 'Without the private email you would not receive the setup confirmation or the daily reports. Ask the developer to fix the email settings, then start again.' })), h('button', { on: { click: boot } }, 'Start again')) } }, 'No')))
)

const setupPassphrase = () => {
    const pf = passphraseFields('pp')
    const err = h('div')
    const go = h('button', { id: 'pp-next', on: { click: () => busy(go, 'Creating keys (a few seconds)…', async () => {
        err.replaceChildren()
        try {
            const passphrase = pf.read()
            const keys = await createKeys()
            const salt = randomBytes(16), recoverySalt = randomBytes(16)
            const recovery = makeRecoveryKey()
            const kek = await kekFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS)
            const byPassphrase = await lockKeys(kek, keys)
            const byRecovery = await lockKeys(await kekFromRecovery(recovery.bytes, recoverySalt), keys)
            wipe(recovery.bytes)
            const publicKey = toB64(keys.publicKey)
            Object.assign(setup, {
                kek, recoveryText: recovery.text, publicKey, fingerprint: await fingerprint(publicKey),
                signingKey: keys.signingKey,   // only to sign the setup upload; dropped right after
                upload: { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, byPassphrase, recoverySalt: toB64(recoverySalt), byRecovery, publicKey },
                createdAt: new Date().toISOString(),
            })
            setupSheet()
        } catch (e) {
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.message })))
        }
    }) } }, 'Create my keys')
    show(h('h1', { text: 'Choose your passphrase' }), steps(2),
        h('div', { class: 'panel' },
            h('p', { text: 'Your passphrase protects every owner key. It never leaves this computer: not even the server sees it. Nobody can reset it for you.' }),
            pf.node, h('p'), err, go))
}

const sheetData = () => ({ recovery: setup.recoveryText, fingerprint: setup.fingerprint, date: setup.createdAt, version: BUILD.version, fileHash: setup.fileHash ?? null })

const renderPrintSheet = d => document.getElementById('sheet').replaceChildren(
    h('h1', { text: 'SMB Owner Console: recovery sheet' }),
    h('p', { text: 'Keep this sheet locked away. Anyone with it AND access to the server could take over the owner key.' }),
    h('dl', {},
        h('dt', { text: 'Recovery key' }), h('dd', {}, h('div', { class: 'groups', text: d.recovery.split('-').join('  ') })),
        h('dt', { text: 'Key fingerprint (shown at every login)' }), h('dd', { class: 'fp', text: d.fingerprint }),
        h('dt', { text: 'Created' }), h('dd', { text: fmtDate(d.date) }),
        h('dt', { text: 'Console file' }), h('dd', { text: `version ${d.version}` }),
        h('dt', { text: 'Console file SHA-256' }), h('dd', { text: d.fileHash ?? '(not added: check the file with  certutil -hashfile <file> SHA256  )' })),
    h('h1', { text: 'If you forget your passphrase' }),
    h('p', { text: 'Open the console, choose "Forgot passphrase", type the recovery key above, then choose a new passphrase.' }),
    h('p', { text: 'At every login, compare the key fingerprint on screen with the one above. If they differ, stop: someone replaced the key.' }),
)

const saveBackupFile = (keysDoc, createdAt = new Date().toISOString()) => {
    const backup = {
        format: 'smb-owner-key-backup-1',
        note: 'Locked owner keys. Useless without the passphrase or the recovery key. Keep it on a USB stick; it lets you restore the keys if the server copy is lost.',
        createdAt, fingerprint: keysDoc.fingerprint, publicKey: keysDoc.publicKey,
        salt: keysDoc.salt, iterations: keysDoc.iterations, byPassphrase: keysDoc.byPassphrase,
        recoverySalt: keysDoc.recoverySalt, byRecovery: keysDoc.byRecovery,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const a = h('a', { href: url, download: `SMB-Owner-key-backup-${keysDoc.fingerprint.slice(0, 9).replace(' ', '')}-${createdAt.slice(0, 10)}.json` })
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const setupSheet = () => {
    let printed = false, saved = false
    const next = h('button', { id: 'sheet-next', disabled: true, on: { click: setupConfirm } }, 'Next')
    const ready = () => { next.disabled = !(printed && saved) }
    const fileInfo = h('p', { class: 'small muted', id: 'file-hash', text: 'Not added yet.' })
    const fileInput = h('input', { type: 'file', id: 'console-file', accept: '.html', on: { change: async e => {
        const f = e.target.files[0]; if (!f) return
        setup.fileHash = (await sha256Hex(new Uint8Array(await f.arrayBuffer()))).toUpperCase().match(/.{8}/g).join(' ')
        fileInfo.textContent = `${f.name}: ${setup.fileHash}`
        renderPrintSheet(sheetData())
    } } })
    renderPrintSheet(sheetData())
    show(h('h1', { text: 'Your recovery sheet' }), steps(3),
        h('div', { class: 'panel' },
            h('p', { text: 'This recovery key is shown ONCE. With it you can set a new passphrase if you forget yours. Print it and keep it locked away.' }),
            h('div', { class: 'groups', id: 'recovery-key', text: setup.recoveryText.split('-').join('  ') }),
            h('p'), h('p', {}, 'Key fingerprint: ', h('span', { class: 'fp small', id: 'setup-fp', text: setup.fingerprint })),
            h('h3', { text: 'Console file fingerprint (recommended)' }),
            h('p', { class: 'small muted', text: 'Select this console file from your computer so its SHA-256 is printed on the sheet. Later you can check that the file was not swapped.' }),
            fileInput, fileInfo,
            h('div', { class: 'row' },
                h('button', { id: 'print-sheet', on: { click: () => { renderPrintSheet(sheetData()); window.print(); printed = true; ready() } } }, 'Print recovery sheet'),
                h('button', { class: 'secondary', id: 'save-backup', on: { click: () => { saveBackupFile({ ...setup.upload, fingerprint: setup.fingerprint }, setup.createdAt); saved = true; ready() } } }, 'Save key backup file')),
            h('p', { class: 'small muted', text: 'The key backup file holds your locked keys (useless without your passphrase or recovery key). Put it on a USB stick.' }),
            next))
}

const setupConfirm = () => {
    const groups = recoveryGroups(setup.recoveryText)
    const a = 1 + Math.floor(Math.random() * 4), b = 5 + Math.floor(Math.random() * 4)   // one from each half
    const ga = txt('confirm-a', { autofocus: true, maxlength: 4 }), gb = txt('confirm-b', { maxlength: 4 })
    const err = h('div')
    const go = h('button', { id: 'confirm-upload', on: { click: () => busy(go, 'Saving…', async () => {
        err.replaceChildren()
        const norm = v => v.trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
        if (norm(ga.value) !== groups[a - 1] || norm(gb.value) !== groups[b - 1]) {
            return err.replaceChildren(alertBox('bad', null, h('p', { text: 'That does not match your recovery sheet. Look at the printed sheet and try again.' })))
        }
        try {
            const body = { email: setup.email, password: setup.password, ...setup.upload }
            const done = await api('POST', '/api/owner/setup', { body, sign: setup.signingKey })
            setup.password = null; setup.signingKey = null
            writePin({ fingerprint: done.fingerprint, chainCount: done.log.count, chainHead: done.log.head })
            // Log straight in with the keys just made (unlocked again, now not extractable).
            const k = await unlockKeys(setup.kek, setup.upload.byPassphrase)
            setup.kek = null
            await finishLogin(k, setup.upload.publicKey)
            setupDone(done)
        } catch (e) {
            if (e.status === 409) return incident('setup-409')
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.message })))
        }
    }) } }, 'Finish setup')
    show(h('h1', { text: 'Check your printed sheet' }), steps(4),
        h('div', { class: 'panel' },
            h('p', { text: 'The recovery key is no longer on screen. Type these two groups from your printed sheet:' }),
            ...field(`Group ${a}`, ga), ...field(`Group ${b}`, gb), h('p'), err, go))
    document.getElementById('sheet').replaceChildren()
}

const setupDone = done => {
    for (const k of Object.keys(setup)) delete setup[k]
    show(h('h1', { text: 'Setup complete' }), steps(5),
        alertBox('good', 'Your Owner Console is ready',
            h('p', {}, 'Key fingerprint: ', h('span', { class: 'fp small', id: 'done-fp', text: done.fingerprint })),
            h('p', { text: done.emailed
                ? 'An email "Owner Console setup completed" was sent to your private address. Check that it shows the same fingerprint, and that it matches your printed sheet.'
                : 'The confirmation email could not be sent. Write the fingerprint down and ask the developer to check the email settings.' })),
        h('button', { id: 'go-main', on: { click: () => mainScreen() } }, 'Open the console'))
}

/* ------------------------------------------------------------------ */
/* Login, forgot passphrase, key backup                                */
/* ------------------------------------------------------------------ */

const readBackupFile = async input => {
    const f = input.files?.[0]
    if (!f) return null
    const b = JSON.parse(await f.text())
    if (b.format !== 'smb-owner-key-backup-1') throw new Error('This is not an Owner Console key backup file.')
    return b
}

/** After the keys are unlocked: prove it to the server with a one-time challenge, check remembered values. */
const finishLogin = async (keys, publicKey) => {
    const fp = await fingerprint(publicKey)
    const pin = readPin()
    if (pin?.fingerprint && pin.fingerprint !== fp) throw new Error('These keys do not belong to the remembered owner key. Stop and check your recovery sheet.')
    if (S.status?.fingerprint && S.status.fingerprint !== fp) throw new Error('These keys do not match the owner key on the server.')
    if (!(await keyMatchesPublic(keys.signingKey, publicKey))) throw new Error('The unlocked key does not match its public key.')
    const { challenge, serverTime } = await api('POST', '/api/owner/challenge')
    S.clockOffset = serverTime - Date.now()
    S.signingKey = keys.signingKey; S.vaultKey = keys.vaultKey; S.publicKey = publicKey; S.fingerprint = fp
    S.tab = 'payroll'   // every unlock starts on the main list
    const r = await api('POST', '/api/owner/login', { body: { challenge }, sign: true })
    S.rollback = null
    if (pin?.chainCount && r.log.count < pin.chainCount) S.rollback = { was: pin.chainCount, now: r.log.count }
    writePin({ fingerprint: fp })
    touch()
    return r
}

const loginScreen = () => {
    const pass = pw('login-pass', { autofocus: true })
    const err = h('div')
    const unlock = async (getLocked) => {
        err.replaceChildren()
        try {
            const k = await getLocked()
            await finishLogin(k.keys, k.publicKey)
            mainScreen()
        } catch (e) {
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.message === 'UNLOCK_FAILED' ? 'Wrong passphrase.' : e.message })))
        }
    }
    const go = h('button', { id: 'login-go', on: { click: () => busy(go, 'Unlocking (about 2 seconds)…', () => unlock(async () => {
        const d = await api('GET', '/api/owner/keys')
        const keys = await unlockKeys(await kekFromPassphrase(pass.value, fromB64(d.salt), d.iterations), d.byPassphrase)
        pass.value = ''
        return { keys, publicKey: d.publicKey }
    })) } }, 'Unlock')
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') go.click() })
    const backupInput = h('input', { type: 'file', id: 'login-backup', accept: '.json' })
    const backupBtn = h('button', { class: 'secondary', on: { click: () => busy(backupBtn, 'Unlocking…', () => unlock(async () => {
        const b = await readBackupFile(backupInput)
        if (!b) throw new Error('Choose the key backup file first.')
        const keys = await unlockKeys(await kekFromPassphrase(pass.value, fromB64(b.salt), b.iterations), b.byPassphrase)
        pass.value = ''
        return { keys, publicKey: b.publicKey }
    })) } }, 'Unlock with the backup file')
    show(h('h1', { text: 'Unlock the Owner Console' }),
        S.lockedReason ? alertBox('info', null, h('p', { text: S.lockedReason })) : null,
        h('div', { class: 'panel' },
            h('p', {}, 'Key fingerprint: ', h('span', { class: 'fp small', id: 'login-fp', text: S.status.fingerprint })),
            h('p', { class: 'small muted', text: 'Compare it with your printed recovery sheet before typing your passphrase. If it differs, stop.' }),
            ...field('Passphrase', pass), h('p'), err,
            h('div', { class: 'row' }, go, h('span', { class: 'spacer' }), h('button', { class: 'link', id: 'forgot', on: { click: forgotScreen } }, 'Forgot passphrase'))),
        h('details', { class: 'panel' }, h('summary', { text: 'The server copy of my keys is lost or damaged' }),
            h('p', { class: 'small muted', text: 'Choose your key backup file, type your passphrase above, then press the button.' }), backupInput, h('p'), backupBtn))
    S.lockedReason = ''
}

const forgotScreen = () => {
    const rec = txt('recovery-input', { autofocus: true, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' })
    const pf = passphraseFields('np')
    const backupInput = h('input', { type: 'file', accept: '.json', id: 'forgot-backup' })
    const err = h('div')
    const go = h('button', { id: 'forgot-go', on: { click: () => busy(go, 'Working (a few seconds)…', async () => {
        err.replaceChildren()
        try {
            const newPass = pf.read()
            const backup = await readBackupFile(backupInput)
            const d = backup ?? await api('GET', '/api/owner/keys')
            const recBytes = parseRecoveryKey(rec.value)
            const ex = await unlockKeys(await kekFromRecovery(recBytes, fromB64(d.recoverySalt)), d.byRecovery, true).catch(() => { throw new Error('That recovery key does not unlock the keys.') })
            wipe(recBytes)
            const salt = randomBytes(16)
            const byPassphrase = await lockKeys(await kekFromPassphrase(newPass, salt, PBKDF2_ITERATIONS), ex)
            if ((await fingerprint(d.publicKey)) !== S.status.fingerprint) throw new Error('This key does not match the owner key on the server.')
            const { serverTime } = await api('POST', '/api/owner/challenge')
            S.clockOffset = serverTime - Date.now()
            await api('PUT', '/api/owner/keys', { body: { reason: 'recovery', salt: toB64(salt), iterations: PBKDF2_ITERATIONS, byPassphrase }, sign: ex.signingKey })
            rec.value = ''
            show(alertBox('good', 'New passphrase set', h('p', { text: 'Your keys are now locked with the new passphrase. Log in with it, then save a new key backup file (Settings).' })),
                h('button', { id: 'forgot-done', on: { click: boot } }, 'Log in'))
        } catch (e) {
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.message })))
        }
    }) } }, 'Set the new passphrase')
    show(h('h1', { text: 'Forgot passphrase' }),
        h('div', { class: 'panel' },
            h('p', { text: 'Type the recovery key from your printed sheet, then choose a new passphrase.' }),
            ...field('Recovery key', rec), pf.node,
            h('details', {}, h('summary', { class: 'small muted', text: 'Use my key backup file instead of the server copy' }), backupInput),
            h('p'), err, h('div', { class: 'row' }, go, h('button', { class: 'secondary', on: { click: boot } }, 'Back'))))
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const DAY = 24 * 3600_000
const verifiedAgo = () => { const p = readPin(); return p?.verifiedAt ? Date.now() - new Date(p.verifiedAt).getTime() : null }
const verifiedText = () => { const a = verifiedAgo(); return a === null ? 'never' : a < DAY ? 'today' : `${Math.floor(a / DAY)} day(s) ago` }
/** Before running payroll or paying: a warning if Verify everything has not run in the last 7 days. */
const staleVerifyNote = () => {
    const a = verifiedAgo()
    if (a !== null && a <= 7 * DAY) return null
    return alertBox('bad', 'Run "Verify everything" first',
        h('p', { text: `It last ran: ${verifiedText()}. Before running payroll or paying, check that nobody changed amounts, pay profiles or bank details behind the console's back.` }),
        h('button', { class: 'secondary', on: { click: () => { S.tab = 'verify'; mainScreen() } } }, 'Go to Verify everything'))
}

/** Signed action; remembers the new history position. */
const act = async (path, body, attachment) => {
    const r = await api('POST', path, { body, sign: true, attachment })
    if (r?.log) writePin({ chainCount: r.log.seq, chainHead: r.log.head })
    return r
}
const money = (n, cur) => (n === null || n === undefined ? '-' : fmtMoney(n, cur))
const numInput = (id, value, extra = {}) => h('input', { id, type: 'text', inputmode: 'decimal', value: value ?? '', autocomplete: 'off', ...extra })
const parseAmount = (v, label) => {
    const t = String(v ?? '').trim().replace(/,/g, '')
    if (t === '') return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: enter an amount of 0 or more`)
    return round2(n)
}
const dubaiMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)

/** Editable list of { name, amount } rows (allowances, deductions). */
const lineItemsEditor = (id, rows, disabled = false) => {
    const list = h('div', { id })
    const addRow = (r = { name: '', amount: '' }) => {
        const row = h('div', { class: 'row', 'data-row': '1' },
            h('input', { type: 'text', class: 'li-name', value: r.name, placeholder: 'Name', disabled }),
            numInput(undefined, r.amount, { class: 'li-amount', placeholder: 'Amount', disabled }),
            disabled ? null : h('button', { class: 'link', type: 'button', on: { click: () => row.remove() } }, 'Remove'))
        list.append(row)
    }
    rows.forEach(addRow)
    const node = h('div', {}, list, disabled ? null : h('button', { class: 'link', type: 'button', id: `${id}-add`, on: { click: () => addRow() } }, '+ Add line'))
    const read = label => [...list.querySelectorAll('[data-row]')].map(r => ({ name: r.querySelector('.li-name').value.trim(), amount: parseAmount(r.querySelector('.li-amount').value, label) ?? 0 }))
        .filter(i => i.name || i.amount).map(i => { if (!i.name) throw new Error(`${label}: every line needs a name`); return i })
    return { node, read }
}

/** Integrity check for some records only (before paying): returns the flags for those keys. */
const flagsFor = async keys => {
    const [log, integ] = await Promise.all([api('GET', '/api/owner/log', { sign: true }), api('GET', '/api/owner/integrity', { sign: true })])
    const r = await checkIntegrity(log.entries, integ.records)
    return r.flags.filter(f => keys.includes(f.key))
}

const mainScreen = () => {
    if (!S.signingKey) return boot()
    const tabs = [['payroll', 'Payroll'], ['people', 'People'], ['requests', 'Requests'], ['companies', 'Companies'], ['projects', 'Projects'], ['expenses', 'Expenses'], ['letters', 'Letters'], ['verify', 'Verify'], ['settings', 'Settings']]
    const body = h('div', { id: 'tab-body' })
    const bar = h('div', { class: 'tabs', role: 'tablist' }, ...tabs.map(([id, label]) =>
        h('button', { role: 'tab', id: `tab-${id}`, class: S.tab === id ? 'on' : '', on: { click: () => { S.tab = id; mainScreen() } } }, label)))
    show(
        h('div', { class: 'status-bar' },
            h('span', {}, 'Key ', h('span', { class: 'fp', id: 'main-fp', text: S.fingerprint })),
            h('span', { class: 'spacer' }),
            h('span', { id: 'last-verified', text: `Verify everything: ${verifiedText()}` }),
            h('span', { text: `Locks after ${Math.round(IDLE_MS / 60000) || '<1'} min idle` }),
            h('button', { class: 'secondary', id: 'lock-now', on: { click: () => lock('Locked.') } }, 'Lock')),
        S.rollback ? alertBox('bad', 'WARNING: the owner history is shorter than before',
            h('p', { text: `This console last saw ${S.rollback.was} entries; the server now has ${S.rollback.now}. Entries were removed. Treat this as a security incident.` })) : null,
        bar, body)
    ;({ payroll: payrollTab, people: peopleTab, requests: requestsTab, companies: companiesTab, projects: projectsTab, expenses: expensesTab, letters: lettersTab, verify: verifyTab, settings: settingsTab })[S.tab](body)
}

/* ---------------- Payroll ---------------- */

const payrollTab = async (body, month = S.month ?? dubaiMonth(), message = null) => {
    S.month = month
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading payroll…' }))
    let d
    try { d = await api('GET', `/api/owner/payroll?month=${encodeURIComponent(month)}`, { sign: true }) }
    catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'payroll-result' }, message)
    const say = (kind, text) => msg.replaceChildren(alertBox(kind, null, h('p', { text })))
    const reload = text => payrollTab(body, month, text ? alertBox('good', null, h('p', { text })) : null)
    const monthIn = h('input', { type: 'month', id: 'payroll-month', value: month, on: { change: e => e.target.value && payrollTab(body, e.target.value) } })
    const pending = d.salaries.filter(s => s.state.status === 'pending')
    const totals = {}
    for (const s of pending) totals[s.state.currency] = round2((totals[s.state.currency] ?? 0) + s.state.netPay)

    const run = h('button', { id: 'run-payroll', on: { click: () => {
        if (run.dataset.confirm !== '1') { run.dataset.confirm = '1'; run.textContent = `Confirm: run payroll for ${month}`; return }
        busy(run, 'Running…', async () => {
            try {
                const r = await act('/api/owner/payroll/run', { action: 'payroll.run', month })
                const skipped = r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.map(s => `${s.name} (${s.reason})`).join('; ')}.` : ''
                reload(`Payroll ${month}: ${r.created} new pending record(s), ${r.alreadyExisted} already existed.${skipped}`)
            } catch (e) { say('bad', e.message) }
        })
    } } }, `Run payroll for ${month}`)

    const pay = async (rows, button) => {
        const keys = rows.flatMap(s => [s.key, `users/${s.state.employeeId}`])
        const flags = await flagsFor(keys)
        if (flags.length) {
            return msg.replaceChildren(alertBox('bad', 'Not paid: these records were changed outside the Owner Console',
                h('ul', {}, ...flags.map(f => h('li', { text: `${f.label}: ${f.problem}` }))), h('p', { text: 'Open Verify everything for the details.' })))
        }
        const changes = rows.map(s => ({ key: s.key, state: { ...s.state, status: 'paid', paymentDetails: s.employeeBank && BANK_FIELDS.some(f => s.employeeBank[f]) ? { ...s.employeeBank, reference: null } : null } }))
        const r = await act('/api/owner/payroll/salaries', { action: 'salary.pay', changes })
        const sent = Object.values(r.emails).filter(x => x === 'sent').length
        reload(`Paid ${r.count} salar${r.count === 1 ? 'y' : 'ies'}. Slip emails sent: ${sent} of ${r.count}. Recorded as entry #${r.log.seq}.`)
        void button
    }

    const payAll = h('button', { id: 'pay-all', disabled: !pending.length, on: { click: () => {
        if (payAll.dataset.confirm !== '1') { payAll.dataset.confirm = '1'; payAll.textContent = `Confirm: pay all ${pending.length} pending (${Object.entries(totals).map(([c, t]) => money(t, c)).join(' + ')})`; return }
        busy(payAll, 'Paying…', () => pay(pending, payAll).catch(e => say('bad', e.message)))
    } } }, `Pay all pending (${pending.length})`)

    const editor = h('div', { id: 'salary-editor' })
    const edit = s => {
        const paid = s.state.status === 'paid'
        const basic = numInput('ed-salary', s.state.salary, { disabled: paid })
        const currency = h('input', { id: 'ed-currency', type: 'text', value: s.state.currency, maxlength: 3, disabled: paid })
        const company = h('select', { id: 'ed-company', disabled: paid }, ...d.companies.map(c => h('option', { value: c.id, selected: c.id === s.state.companyId }, c.name + (c.isActive ? '' : ' (inactive)'))))
        const al = lineItemsEditor('ed-allowances', s.state.allowances, paid), de = lineItemsEditor('ed-deductions', s.state.deductions, paid)
        const notes = h('input', { id: 'ed-notes', type: 'text', value: s.state.notes ?? '' })
        const save = h('button', { id: 'ed-save', on: { click: () => busy(save, 'Saving…', async () => {
            try {
                const next = { ...s.state, notes: notes.value.trim() }
                if (!paid) {
                    next.salary = parseAmount(basic.value, 'Basic salary'); next.currency = currency.value.trim().toUpperCase(); next.companyId = company.value
                    next.allowances = al.read('Allowances'); next.deductions = de.read('Deductions')
                    Object.assign(next, computeTotals(next))
                }
                await act('/api/owner/payroll/salaries', { action: 'salary.update', changes: [{ key: s.key, state: normalizeSalary(next) }] })
                reload(`Saved: ${s.employee}, ${month}.`)
            } catch (e) { say('bad', e.message) }
        }) } }, 'Save (signed)')
        editor.replaceChildren(h('div', { class: 'panel' }, h('h3', { text: `Edit salary: ${s.employee}, ${month}` }),
            paid ? h('p', { class: 'small muted', text: 'Paid salaries are locked: only the notes can change.' }) : null,
            ...field('Basic salary', basic), ...field('Currency', currency), h('label', { text: 'Paying company' }), company,
            h('label', { text: 'Allowances' }), al.node, h('label', { text: 'Deductions' }), de.node, ...field('Notes', notes), h('p'),
            h('div', { class: 'row' }, save, h('button', { class: 'secondary', on: { click: () => editor.replaceChildren() } }, 'Cancel'))))
        editor.scrollIntoView?.()
    }

    const rowsEl = d.salaries.map(s => {
        const st = s.state
        const actions = []
        if (st.status === 'pending') {
            const pb = h('button', { 'data-pay': s.id })
            pb.textContent = 'Pay'
            pb.addEventListener('click', () => {
                if (pb.dataset.confirm !== '1') { pb.dataset.confirm = '1'; pb.textContent = `Confirm: pay ${money(st.netPay, st.currency)}`; return }
                busy(pb, 'Paying…', () => pay([s], pb).catch(e => say('bad', e.message)))
            })
            actions.push(h('button', { class: 'secondary', 'data-edit': s.id, on: { click: () => edit(s) } }, 'Edit'), pb)
        } else {
            const rb = h('button', { class: 'secondary', 'data-resend': s.id, on: { click: () => busy(rb, 'Sending…', async () => {
                try { const r = await act(`/api/owner/payroll/salaries/${s.id}/resend`, { action: 'salary.resend' }); reload(`Slip for ${s.employee}: ${r.email}.`) }
                catch (e) { say('bad', e.message) }
            }) } }, 'Resend slip')
            actions.push(h('button', { class: 'secondary', 'data-edit': s.id, on: { click: () => edit(s) } }, 'Notes'), rb)
        }
        const bankLine = s.employeeBank?.iban || s.employeeBank?.accountNumber || '(no bank details)'
        return h('tr', { 'data-salary': s.id }, h('td', { text: s.employee }), h('td', { text: s.company }), h('td', { class: 'mono', text: money(st.netPay, st.currency) }),
            h('td', { class: st.status === 'paid' ? 'ok' : '', text: st.status }), h('td', { class: 'mono small', text: bankLine }), h('td', {}, h('div', { class: 'row' }, ...actions)))
    })

    body.replaceChildren(staleVerifyNote() ?? '', msg,
        h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', { text: 'Payroll' }), h('span', { class: 'spacer' }), monthIn),
            h('p', { class: 'small muted', text: `Pending this month: ${pending.length} (${Object.entries(totals).map(([c, t]) => money(t, c)).join(' + ') || 'nothing'}). Pending in other months: ${d.otherPending}.` }),
            h('div', { class: 'row' }, run, payAll),
            d.salaries.length
                ? h('table', { id: 'payroll-table' }, h('thead', {}, h('tr', {}, ...['Employee', 'Company', 'Net pay', 'Status', 'Bank', ''].map(t => h('th', { text: t })))), h('tbody', {}, ...rowsEl))
                : h('p', { class: 'muted', text: 'No salary records for this month yet. "Run payroll" creates them from the signed pay profiles.' })),
        editor)
}

/* ---------------- People ---------------- */

const HISTORY_TYPES = ['salary_increase', 'salary_decrease', 'promotion', 'demotion', 'joined', 'position_change', 'transfer', 'rejoined', 'other']

const peopleTab = async (body, message = null, openId = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading people…' }))
    let d
    try { d = await api('GET', '/api/owner/people', { sign: true }) }
    catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'people-result' }, message)
    const say = (kind, text) => msg.replaceChildren(alertBox(kind, null, h('p', { text })))
    const companyName = id => d.companies.find(c => c.id === id)?.name ?? '-'
    const editor = h('div', { id: 'person-editor' })

    const open = (p) => {
        const isNew = !p
        const s = p?.state ?? normalizeUser({ role: 'employee', status: 'active', salary: { currency: 'AED', allowances: [] } })
        const lock = !!p?.isOwner
        const inp = (id, v, extra = {}) => h('input', { id, type: 'text', value: v ?? '', autocomplete: 'off', ...extra })
        const name = inp('pe-name', s.name), email = inp('pe-email', s.email), position = inp('pe-position', s.position)
        const company = h('select', { id: 'pe-company' }, h('option', { value: '' }, '(none)'), ...d.companies.map(c => h('option', { value: c.id, selected: c.id === s.companyId }, c.name)))
        const role = h('select', { id: 'pe-role', disabled: lock }, ...['employee', 'admin'].map(r => h('option', { value: r, selected: s.role === r }, r)))
        const status = h('select', { id: 'pe-status', disabled: lock }, ...['active', 'inactive'].map(r => h('option', { value: r, selected: s.status === r }, r)))
        const approver = h('input', { id: 'pe-approver', type: 'checkbox', checked: s.canApproveDeliverables })
        const amount = numInput('pe-salary', s.salary.amount), currency = inp('pe-currency', s.salary.currency, { maxlength: 3 })
        const al = lineItemsEditor('pe-allowances', s.salary.allowances)
        const bank = Object.fromEntries(BANK_FIELDS.map(f => [f, inp(`pe-bank-${f}`, s.bankDetails[f])]))
        const save = h('button', { id: 'pe-save', on: { click: () => busy(save, 'Saving…', async () => {
            try {
                const next = normalizeUser({
                    name: name.value, email: email.value, position: position.value, companyId: company.value || null, role: role.value, status: status.value,
                    canApproveDeliverables: approver.checked,
                    salary: { amount: parseAmount(amount.value, 'Salary'), currency: currency.value.trim().toUpperCase() || null, allowances: al.read('Allowances') },
                    bankDetails: Object.fromEntries(BANK_FIELDS.map(f => [f, bank[f].value])),
                })
                const id = p?.id ?? newRecordId()
                await act('/api/owner/people', { action: isNew ? 'user.create' : 'user.update', changes: [{ key: `users/${id}`, state: next }] })
                peopleTab(body, alertBox('good', null, h('p', { text: isNew ? `${next.name} added. They get an email to choose their password.` : `Saved: ${next.name}.` })), id)
            } catch (e) { say('bad', e.message) }
        }) } }, isNew ? 'Add person (signed)' : 'Save (signed)')
        const hist = h('div', { id: 'salary-history' })
        editor.replaceChildren(h('div', { class: 'panel' }, h('h3', { text: isNew ? 'Add a person' : `${s.name}` }),
            lock ? h('p', { class: 'small muted', text: 'This is your own account: it stays an active admin.' }) : null,
            ...field('Name', name), ...field('Email', email), ...field('Position', position), h('label', { text: 'Company' }), company,
            h('div', { class: 'row' }, h('div', {}, h('label', { text: 'Role' }), role), h('div', {}, h('label', { text: 'Status' }), status),
                h('label', { class: 'row' }, approver, ' Can approve daily plans')),
            h('h3', { text: 'Pay profile' }), ...field('Monthly salary', amount), ...field('Currency', currency), h('label', { text: 'Recurring allowances' }), al.node,
            h('h3', { text: 'Bank details' }), ...BANK_FIELDS.flatMap(f => field({ method: 'Method', bankName: 'Bank', holderName: 'Account holder', accountNumber: 'Account number', iban: 'IBAN' }[f], bank[f])),
            h('p', { class: 'small muted', text: 'Changing bank details: confirm them with the person by phone first.' }),
            h('div', { class: 'row' }, save, h('button', { class: 'secondary', on: { click: () => editor.replaceChildren() } }, 'Close')), hist))
        if (!isNew) salaryHistory(hist, p.id, s.salary.currency)
    }

    const rows = d.people.map(p => h('tr', { 'data-person': p.id },
        h('td', {}, h('button', { class: 'link', on: { click: () => open(p) } }, p.state.name)), h('td', { class: 'small', text: p.state.email }),
        h('td', { text: p.state.role }), h('td', { class: p.state.status === 'active' ? '' : 'bad', text: p.state.status }),
        h('td', { text: p.state.canApproveDeliverables ? 'yes' : '' }), h('td', { class: 'small', text: companyName(p.state.companyId) }),
        h('td', { class: 'mono', text: money(p.state.salary.amount, p.state.salary.currency) })))
    body.replaceChildren(msg,
        d.pendingBank ? alertBox('info', null, h('p', { text: `${d.pendingBank} bank details request(s) waiting: see Requests.` })) : '',
        h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', { text: 'People' }), h('span', { class: 'spacer' }),
            h('button', { id: 'add-person', on: { click: () => open(null) } }, 'Add person')),
            h('table', { id: 'people-table' }, h('thead', {}, h('tr', {}, ...['Name', 'Email', 'Role', 'Status', 'Approver', 'Company', 'Salary'].map(t => h('th', { text: t })))), h('tbody', {}, ...rows))),
        editor)
    if (openId) { const p = d.people.find(x => x.id === openId); if (p) open(p) }
}

const salaryHistory = async (box, personId, currency) => {
    let rows
    try { rows = await api('GET', `/api/owner/people/${personId}/salary-history`, { sign: true }) }
    catch (e) { return box.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const form = h('div')
    const editEntry = (e) => {
        const s = e?.state ?? { type: 'salary_increase', title: '', effectiveDate: new Date().toISOString(), fromSalary: null, toSalary: null, currency, fromPosition: null, toPosition: null, description: null }
        const type = h('select', { id: 'sh-type' }, ...HISTORY_TYPES.map(t => h('option', { value: t, selected: s.type === t }, t.replace(/_/g, ' '))))
        const title = h('input', { id: 'sh-title', type: 'text', value: s.title ?? '' })
        const date = h('input', { id: 'sh-date', type: 'date', value: (s.effectiveDate ?? '').slice(0, 10) })
        const from = numInput('sh-from', s.fromSalary), to = numInput('sh-to', s.toSalary), cur = h('input', { id: 'sh-currency', type: 'text', value: s.currency ?? '', maxlength: 3 })
        const desc = h('input', { id: 'sh-desc', type: 'text', value: s.description ?? '' })
        const send = async state => {
            const id = e?.id ?? newRecordId()
            await act('/api/owner/people/salary-history', { action: 'history.save', changes: [{ key: `history/${id}`, state }] })
            salaryHistory(box, personId, currency)
        }
        const save = h('button', { id: 'sh-save', on: { click: () => busy(save, 'Saving…', async () => {
            try {
                if (!date.value) throw new Error('Choose a date')
                await send(normalizeHistory({ ...s, employeeId: personId, type: type.value, title: title.value, description: desc.value,
                    effectiveDate: new Date(`${date.value}T00:00:00Z`).toISOString(), fromSalary: parseAmount(from.value, 'From salary'), toSalary: parseAmount(to.value, 'To salary'), currency: cur.value.trim().toUpperCase() }))
            } catch (err) { form.prepend(alertBox('bad', null, h('p', { text: err.message }))) }
        }) } }, 'Save entry (signed)')
        const del = e ? h('button', { class: 'danger', id: 'sh-delete', on: { click: () => {
            if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirm: delete entry'; return }
            busy(del, 'Deleting…', () => send(null).catch(err => form.prepend(alertBox('bad', null, h('p', { text: err.message })))))
        } } }, 'Delete entry') : null
        form.replaceChildren(h('div', { class: 'panel' }, h('label', { text: 'Type' }), type, ...field('Title', title), ...field('Date', date),
            h('div', { class: 'row' }, h('div', {}, ...field('From salary', from)), h('div', {}, ...field('To salary', to)), h('div', {}, ...field('Currency', cur))),
            ...field('Note', desc), h('p'), h('div', { class: 'row' }, save, del)))
    }
    box.replaceChildren(h('h3', { text: 'Salary history' }),
        rows.length ? h('table', {}, h('tbody', {}, ...rows.map(e => h('tr', { 'data-history': e.id }, h('td', { text: (e.state.effectiveDate ?? '').slice(0, 10) }), h('td', { text: e.state.title }),
            h('td', { class: 'mono', text: `${money(e.state.fromSalary, e.state.currency)} → ${money(e.state.toSalary, e.state.currency)}` }),
            h('td', {}, h('button', { class: 'link', on: { click: () => editEntry(e) } }, 'Edit')))))) : h('p', { class: 'small muted', text: 'No salary entries.' }),
        h('button', { class: 'link', id: 'sh-add', on: { click: () => editEntry(null) } }, '+ Add salary entry'), form)
}

/* ---------------- Requests (bank details) ---------------- */

const requestsTab = async (body, message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading requests…' }))
    let rows
    try { rows = await api('GET', '/api/owner/people/bank-requests', { sign: true }) }
    catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'requests-result' }, message)
    const labels = { method: 'Method', bankName: 'Bank', holderName: 'Account holder', accountNumber: 'Account number', iban: 'IBAN' }
    const cards = rows.map(r => {
        const approve = h('button', { 'data-approve': r.id, on: { click: () => {
            if (approve.dataset.confirm !== '1') { approve.dataset.confirm = '1'; approve.textContent = `I called ${r.employee}: approve`; return }
            busy(approve, 'Approving…', async () => {
                try {
                    const flags = await flagsFor([r.key])
                    if (flags.length) throw new Error(`${r.employee}'s record was changed outside the Owner Console. Check Verify everything first.`)
                    await act(`/api/owner/people/bank-requests/${r.id}`, { action: 'bank.approve', changes: [{ key: r.key, state: { ...r.state, bankDetails: r.requested } }] })
                    requestsTab(body, alertBox('good', null, h('p', { text: `Approved: new bank details for ${r.employee}.` })))
                } catch (e) { msg.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
            })
        } } }, 'Approve')
        const reject = h('button', { class: 'secondary', 'data-reject': r.id, on: { click: () => busy(reject, 'Rejecting…', async () => {
            try { await act(`/api/owner/people/bank-requests/${r.id}`, { action: 'bank.reject' }); requestsTab(body, alertBox('good', null, h('p', { text: `Rejected the request of ${r.employee}.` }))) }
            catch (e) { msg.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
        }) } }, 'Reject')
        return h('div', { class: 'panel', 'data-request': r.id }, h('h3', { text: `${r.employee} asks for new bank details` }),
            h('p', { class: 'small muted', text: `${r.email} · ${fmtDate(r.createdAt)}` }),
            h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: 'Now (in use)' }), h('th', { text: 'Requested' }))),
                h('tbody', {}, ...BANK_FIELDS.map(f => h('tr', {}, h('td', { text: labels[f] }), h('td', { class: 'mono', text: r.state?.bankDetails?.[f] ?? '' }),
                    h('td', { class: `mono ${(r.state?.bankDetails?.[f] ?? null) !== r.requested[f] ? 'ok' : ''}`, text: r.requested[f] ?? '' }))))),
            alertBox('info', null, h('p', { text: `Before approving, call ${r.employee} on a number you already know (not one from this request) and read the new IBAN back to them.` })),
            h('div', { class: 'row' }, approve, reject))
    })
    body.replaceChildren(msg, rows.length ? h('div', {}, ...cards) : h('div', { class: 'panel' }, h('p', { class: 'muted', text: 'No requests waiting.' })))
}

/* ---------------- Verify everything (history + records) ---------------- */

const extraSummary = by => {
    const sum = (rows, val, cur) => { const t = {}; for (const r of rows) { const v = val(r); if (v) t[cur(r) ?? '?'] = round2((t[cur(r) ?? '?'] ?? 0) + v) } return Object.entries(t).map(([c, v]) => money(v, c)).join(' + ') || '0' }
    const companies = by('companies'), projects = by('projects'), ms = by('milestones'), ex = by('expenses').filter(e => !e.isDeleted), lt = by('certificates')
    return [
        companies.length ? `Companies: ${companies.length} (${companies.filter(c => c.isActive).length} active): ${companies.map(c => c.name).join(', ')}` : null,
        projects.length ? `Project budgets: ${projects.filter(p => p.budget > 0).length} of ${projects.length} projects, total ${money(projects.reduce((t, p) => t + p.budget, 0), 'AED')}` : null,
        ms.length ? `Milestone payments: ${ms.length} (paid ${sum(ms.filter(m => m.paymentStatus === 'paid'), m => m.paymentAmount, m => m.currency)}; invoiced ${sum(ms.filter(m => m.paymentStatus === 'invoiced'), m => m.paymentAmount, m => m.currency)})` : null,
        ex.length ? `Expenses: ${['pending', 'approved', 'reimbursed', 'rejected'].map(st => `${st} ${ex.filter(e => e.status === st).length} (${sum(ex.filter(e => e.status === st), e => e.totalAmount, e => e.currency)})`).join('; ')}` : null,
        lt.length ? `Letters and certificates: ${lt.length} (${lt.filter(l => l.status === 'active').length} active, ${lt.filter(l => l.status === 'revoked').length} revoked)` : null,
    ]
}

const summarize = records => {
    const by = t => records.filter(r => r.key.startsWith(`${t}/`)).map(r => r.state)
    const users = by('users'), salaries = by('salaries'), history = by('history')
    const sumBy = (rows, val, cur) => { const t = {}; for (const r of rows) { const v = val(r); if (v) t[cur(r) ?? '?'] = round2((t[cur(r) ?? '?'] ?? 0) + v) } return Object.entries(t).map(([c, v]) => money(v, c)).join(' + ') || '0' }
    const admins = users.filter(u => u.role === 'admin'), approvers = users.filter(u => u.canApproveDeliverables)
    const active = users.filter(u => u.status === 'active')
    return [
        users.length ? `People: ${users.length} (${active.length} active, ${users.length - active.length} inactive)` : null,
        users.length ? `Admins: ${admins.length}: ${admins.map(u => u.name).join(', ') || 'none'}` : null,
        users.length ? `Can approve daily plans: ${approvers.length}: ${approvers.map(u => u.name).join(', ') || 'none'}` : null,
        users.length ? `Monthly salaries of active people: ${sumBy(active, u => u.salary.amount, u => u.salary.currency)}` : null,
        users.length ? `People with bank details: ${users.filter(u => BANK_FIELDS.some(f => u.bankDetails[f])).length}` : null,
        salaries.length ? `Salary records: ${salaries.length} (paid ${salaries.filter(s => s.status === 'paid').length}: ${sumBy(salaries.filter(s => s.status === 'paid'), s => s.netPay, s => s.currency)}; pending ${salaries.filter(s => s.status === 'pending').length}: ${sumBy(salaries.filter(s => s.status === 'pending'), s => s.netPay, s => s.currency)})` : null,
        history.length ? `Salary-history entries: ${history.length}` : null,
        ...extraSummary(by),
    ].filter(Boolean)
}

const verifyTab = body => {
    const out = h('div', { id: 'verify-result' })
    const recOut = h('div', { id: 'records-result' })
    const adoptBox = h('div', { id: 'adopt-box' })
    const list = h('div')
    const run = async () => {
        out.replaceChildren(); recOut.replaceChildren(); adoptBox.replaceChildren(); list.replaceChildren()
        const d = await api('GET', '/api/owner/log', { sign: true })
        const integ = await api('GET', '/api/owner/integrity', { sign: true })
        const pin = readPin()
        const fp = await fingerprint(d.publicKey)
        const problems = []
        if (fp !== S.fingerprint) problems.push({ seq: '-', problem: `the server verifies with a different key (${fp})` })
        const v = await verifyChain(d.entries, S.publicKey)
        problems.push(...v.problems)
        if (pin?.chainCount && v.count < pin.chainCount) problems.push({ seq: '-', problem: `the history is shorter than when last checked here (${pin.chainCount} entries before, ${v.count} now)` })
        if (pin?.chainCount && pin.chainHead && v.count >= pin.chainCount) {
            const then = d.entries.find(e => e.seq === pin.chainCount)
            if (!then || then.hash !== pin.chainHead) problems.push({ seq: pin.chainCount, problem: 'differs from the entry this console saw before (the history was rewritten)' })
        }
        const r = await checkIntegrity(problems.length ? d.entries.filter(() => false) : d.entries, integ.records)
        writePin({ verifiedAt: new Date().toISOString(), ...(problems.length ? {} : { chainCount: v.count, chainHead: v.head }) })
        document.getElementById('last-verified')?.replaceChildren(`Verify everything: ${verifiedText()}`)

        out.replaceChildren(problems.length
            ? alertBox('bad', `✘ History: problems found (${problems.length})`, h('ul', { id: 'verify-problems' }, ...problems.map(p => h('li', { text: `Entry ${p.seq}: ${p.problem}` }))),
                h('p', {}, 'Chain fingerprint now: ', h('span', { class: 'fp small', text: shortHash(v.head) })), h('p', { text: 'Someone changed your owner history on the server. Treat this as a security incident.' }))
            : alertBox('good', `✔ History verified: ${v.count} entries`, h('p', {}, 'Chain fingerprint: ', h('span', { class: 'fp small', id: 'chain-fp', text: shortHash(v.head) })),
                h('p', { class: 'small', text: 'Every link and every signature checks out with your key. Compare the chain fingerprint and the entry count with your latest daily report email.' })))

        const notAdopted = Object.entries(r.notAdopted)
        recOut.replaceChildren(problems.length
            ? alertBox('bad', 'Records not checked', h('p', { text: 'The history itself is not trustworthy, so records cannot be checked against it.' }))
            : r.flags.length
                ? alertBox('bad', `✘ Records: ${r.flags.length} changed outside the Owner Console`, h('ul', { id: 'records-problems' }, ...r.flags.map(f => h('li', {},
                    h('b', { text: f.label }), `: ${f.problem}`,
                    f.fields?.length ? h('table', { class: 'small' }, h('tbody', {}, ...f.fields.map(x => h('tr', {}, h('td', { class: 'mono', text: x.field }),
                        h('td', { text: `signed: ${JSON.stringify(x.signed)}` }), h('td', { class: 'bad', text: `now: ${JSON.stringify(x.now)}` }))))) : null))),
                    h('p', { text: 'These records were changed directly in the database. Treat this as a security incident.' }))
                : (() => {
                    const checkedNow = r.checked - notAdopted.reduce((n, [, c]) => n + c, 0)
                    if (!checkedNow && notAdopted.length) return alertBox('info', 'Records: not checked yet', h('p', { text: 'None of the existing records has been adopted yet. Check the summary below and adopt them; from then on every change made outside the console is flagged.' }))
                    return alertBox('good', `✔ Records verified: ${checkedNow} owner records match their last signed state`,
                        notAdopted.length ? h('p', { class: 'small', text: `Not adopted yet (not checked): ${notAdopted.map(([t, c]) => `${c} ${t}`).join(', ')}.` }) : null)
                })())

        if (!problems.length && notAdopted.length) {
            const types = notAdopted.map(([t]) => t)
            const recs = integ.records.filter(x => types.includes(x.key.split('/')[0]))
            const go = h('button', { id: 'adopt-go', on: { click: () => {
                if (go.dataset.confirm !== '1') { go.dataset.confirm = '1'; go.textContent = 'Confirm: these figures are right, adopt them'; return }
                busy(go, 'Adopting…', async () => {
                    try {
                        const res = await act('/api/owner/adopt', { action: 'adopt', types, changes: recs.map(x => ({ key: x.key, state: x.state })) })
                        adoptBox.replaceChildren(alertBox('good', null, h('p', { text: `Adopted ${res.records} records as entry #${res.seq}.` })))
                        await run()
                    } catch (e) { adoptBox.prepend(alertBox('bad', null, h('p', { text: e.message }))) }
                })
            } } }, 'Adopt current records')
            adoptBox.replaceChildren(h('div', { class: 'panel' }, h('h2', { text: 'Adopt current records' }),
                h('p', { text: `These records existed before the Owner Console took over (${notAdopted.map(([t, n]) => `${n} ${t}`).join(', ')}). Adopting signs them as they are today, as your starting point. From then on, any change made outside the console is flagged.` }),
                h('ul', { id: 'adopt-summary' }, ...summarize(recs).map(l => h('li', { text: l }))),
                alertBox('bad', null, h('p', { id: 'adopt-warning', text: 'Check these totals against what you know (salaries, approvers, admins). Adopting accepts today\'s database as true: anything wrong here becomes your starting point.' })),
                go))
        }

        list.replaceChildren(h('div', { class: 'panel' }, h('h3', { text: 'History' }),
            h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'Time', 'Action', 'Record', 'Result'].map(t => h('th', { text: t })))),
                h('tbody', {}, ...[...d.entries].reverse().slice(0, 300).map(e => h('tr', {},
                    h('td', { class: 'mono', text: e.seq }), h('td', { text: fmtDate(e.at) }), h('td', { class: 'mono', text: e.action }),
                    h('td', { class: 'mono small', text: e.recordId ?? '' }), h('td', { class: 'small', text: e.result ?? '' })))))))
    }
    const go = h('button', { id: 'verify-all', on: { click: () => busy(go, 'Verifying…', () => run().catch(e => out.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))))) } }, 'Verify everything')
    body.replaceChildren(h('div', { class: 'panel' }, h('h2', { text: 'Verify everything' }),
        h('p', { class: 'small muted', text: 'Re-checks, on this computer, your whole owner history (every link and your signature on each entry) and every owner-controlled record against its last signed state.' }),
        h('p', { class: 'small', text: `Last run: ${verifiedText()}` }), go), out, recOut, adoptBox, list)
}

const settingsTab = body => {
    const cur = pw('cp-current')
    const pf = passphraseFields('cp')
    const err = h('div', { id: 'cp-result' })
    const go = h('button', { id: 'cp-go', on: { click: () => busy(go, 'Changing (a few seconds)…', async () => {
        err.replaceChildren()
        try {
            const newPass = pf.read()
            const d = await api('GET', '/api/owner/keys')
            const ex = await unlockKeys(await kekFromPassphrase(cur.value, fromB64(d.salt), d.iterations), d.byPassphrase, true)
                .catch(() => { throw new Error('The current passphrase is wrong.') })
            const salt = randomBytes(16)
            const byPassphrase = await lockKeys(await kekFromPassphrase(newPass, salt, PBKDF2_ITERATIONS), ex)
            await api('PUT', '/api/owner/keys', { body: { reason: 'change', salt: toB64(salt), iterations: PBKDF2_ITERATIONS, byPassphrase }, sign: true })
            cur.value = ''
            err.replaceChildren(alertBox('good', null, h('p', { text: 'Passphrase changed. Save a new key backup file below: the old one still opens only with the old passphrase (or the recovery key).' })))
        } catch (e) {
            err.replaceChildren(alertBox('bad', null, h('p', { text: e.message })))
        }
    }) } }, 'Change passphrase')
    const save = h('button', { class: 'secondary', id: 'save-backup-settings', on: { click: () => busy(save, 'Preparing…', async () => {
        saveBackupFile(await api('GET', '/api/owner/keys'))
    }) } }, 'Save key backup file')
    body.replaceChildren(
        h('div', { class: 'panel' }, h('h2', { text: 'Change passphrase' }), ...field('Current passphrase', cur), pf.node, h('p'), err, go),
        h('div', { class: 'panel' }, h('h2', { text: 'Key backup' }),
            h('p', { class: 'small muted', text: 'A file with your locked keys, for a USB stick. Useless without your passphrase or recovery key.' }), save))
}

boot()
