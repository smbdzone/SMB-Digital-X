import crypto from 'node:crypto'
import express, { NextFunction, Request, Response, Router } from 'express'
import OwnerKey, { ILockedKeys, OWNER_KEY_ID } from '../model/ownerKey.model.js'
import OwnerNonce from '../model/ownerNonce.model.js'
import User from '../model/user.model.js'
import Salary from '../model/salary.model.js'
import { rateLimit } from '../middlewares/rateLimit.js'
import { updateSalaryRecord } from '../services/salary.service.js'
import { AppError, badRequest, conflict, escapeRegex, forbidden, isObjectId, notFound, unauthorized } from '../utils/http.js'
import {
    appendOwnerLog, checkSignedRequest, getOwnerKey, maskEmail, ownerLogEntries, ownerLogHead, ownerReportAddress,
    rawBodyOf, sendOwnerMail, setupWindow,
} from './owner.service.js'
import { fingerprint, importPublicKey } from './signing.js'
import { jsonBody, owner, requireOwner } from './ownerHttp.js'
import integrityRoutes from './integrity.routes.js'
import payrollRoutes from './payroll.routes.js'

/*
 * Owner Console API (/api/owner). Called only by the Owner Console: one local HTML file on the owner's laptop,
 * opened from file:// (its requests carry "Origin: null"). Every request except status, keys, challenge and the
 * setup checks is signed with the owner's key (see owner.service.ts checkSignedRequest). No cookies, no sessions.
 */
const router = Router()

const MIN_ITERATIONS = 1_000_000
const MAX_ITERATIONS = 50_000_000
const HOUR = 60 * 60_000

/* ------------------------------------------------------------------ */
/* CORS for the local console file, and the raw body                    */
/* ------------------------------------------------------------------ */

// Only the console's file:// origin ("null") gets CORS headers, and never credentials. The website's own CORS
// rules are not used for these routes (index.ts skips them), so nothing changes for the website.
router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.get('origin') === 'null') {
        res.set('Access-Control-Allow-Origin', 'null')
        res.set('Vary', 'Origin')
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Allow-Methods', 'GET, POST, PUT')
            res.set('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Ts, X-Owner-Nonce, X-Owner-Sig')
            res.set('Access-Control-Max-Age', '600')
        }
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    next()
})

// The signature covers the exact body bytes, so the body is kept raw and parsed here (index.ts skips its JSON parser).
// 2 MB: "Adopt current records" sends every protected record in one signed body.
router.use(express.raw({ type: () => true, limit: '2mb' }))
/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const b64 = (value: unknown, name: string, minBytes: number, maxBytes: number): string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw badRequest(`${name} must be base64`)
    const n = Buffer.from(value, 'base64').length
    if (n < minBytes || n > maxBytes) throw badRequest(`${name} has the wrong length`)
    return value
}
const lockedKeys = (value: any, name: string): ILockedKeys => ({
    vault: { iv: b64(value?.vault?.iv, `${name}.vault.iv`, 12, 12), data: b64(value?.vault?.data, `${name}.vault.data`, 40, 80) },
    signing: { iv: b64(value?.signing?.iv, `${name}.signing.iv`, 12, 12), data: b64(value?.signing?.data, `${name}.signing.data`, 100, 400) },
})
const iterationsOf = (value: unknown) => {
    if (!Number.isInteger(value) || (value as number) < MIN_ITERATIONS || (value as number) > MAX_ITERATIONS) {
        throw badRequest(`iterations must be a whole number between ${MIN_ITERATIONS} and ${MAX_ITERATIONS}`)
    }
    return value as number
}

/** The owner account: an active admin with this email and password. Same answer for every kind of mismatch. */
const ownerAccount = async (email: unknown, password: unknown) => {
    const refuse = () => unauthorized('Email or password is wrong, or this account cannot own the console')
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) throw refuse()
    const user = await User.findOne({ email: new RegExp(`^${escapeRegex(email.trim())}$`, 'i') }).select('+password')
    if (!user || user.role !== 'admin' || user.status === 'inactive' || !(await user.comparePassword(password))) throw refuse()
    return user
}

const fmtTime = (d: Date) => `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC (${d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })} Dubai)`

/* ------------------------------------------------------------------ */
/* Not signed: status, locked keys, login challenge, setup              */
/* ------------------------------------------------------------------ */

router.get('/status', async (_req, res) => {
    const key = await getOwnerKey()
    const window = setupWindow()
    res.json({ success: true, data: { setUp: !!key, fingerprint: key?.fingerprint ?? null, setupWindowOpen: !key && window.open, serverTime: Date.now() } })
})

// The locked keys. Anyone can fetch them (the console needs them before it is unlocked); they are useless
// without the passphrase or the recovery key. Limited so an outsider cannot download them in bulk.
let keysToday = { day: '', count: 0 }
router.get('/keys', rateLimit({ windowMs: HOUR, max: 20, message: 'Too many requests. Try again later.' }), async (_req, res) => {
    const day = new Date().toISOString().slice(0, 10)
    if (keysToday.day !== day) keysToday = { day, count: 0 }
    if (++keysToday.count > 100) throw new AppError(429, 'Too many requests today. Try again tomorrow.')
    const key = await getOwnerKey()
    if (!key) throw notFound('The Owner Console is not set up')
    const { salt, iterations, byPassphrase, recoverySalt, byRecovery, publicKey, fingerprint: fp } = key
    res.json({ success: true, data: { salt, iterations, byPassphrase, recoverySalt, byRecovery, publicKey, fingerprint: fp } })
})

router.post('/challenge', rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many attempts. Try again in a few minutes.' }), async (_req, res) => {
    const challenge = crypto.randomBytes(24).toString('base64url')
    await OwnerNonce.create({ _id: challenge, kind: 'challenge', expiresAt: new Date(Date.now() + 2 * 60_000) })
    res.json({ success: true, data: { challenge, serverTime: Date.now() } })
})

// Setup step 1: before any key is made, check the window, the owner account and the report email (test email sent).
router.post('/setup/check', rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many attempts. Try again in a few minutes.' }), async (req, res) => {
    if (await getOwnerKey()) throw conflict('ALREADY_SET_UP')
    if (!setupWindow().open) throw forbidden('SETUP_WINDOW_CLOSED')
    const b = jsonBody(req)
    const user = await ownerAccount(b.email, b.password)
    const to = ownerReportAddress()
    if (!to) throw new AppError(503, 'OWNER_REPORT_EMAIL is not set on the server. Ask the developer to set it, then try again.')
    try {
        await sendOwnerMail('Owner Console: test email', [
            'This is a test from the Owner Console setup.',
            '',
            `Account: ${user.name}`,
            `Time: ${fmtTime(new Date())}`,
            '',
            'If you did not start the Owner Console setup just now, someone else is trying to: tell Sir Simo at once.',
        ])
    } catch (error) {
        console.error('[owner] test email failed:', error instanceof Error ? error.message : error)
        throw new AppError(502, 'The test email could not be sent. Check the email settings on the server.')
    }
    res.json({ success: true, data: { reportTo: maskEmail(to), windowUntil: setupWindow().until } })
})

// Setup step 2 (once ever): the locked keys and the public key. Signed with the NEW key, which proves the
// console holds it. The owner's website email and password bind it to the owner account.
router.post('/setup', rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many attempts. Try again in a few minutes.' }), async (req, res) => {
    if (await getOwnerKey()) throw conflict('ALREADY_SET_UP')
    if (!setupWindow().open) throw forbidden('SETUP_WINDOW_CLOSED')
    const b = jsonBody(req)
    const user = await ownerAccount(b.email, b.password)

    const publicKey = b64(b.publicKey, 'publicKey', 80, 100)
    try { await importPublicKey(publicKey) } catch { throw badRequest('publicKey is not an ECDSA P-256 public key') }
    const doc = {
        _id: OWNER_KEY_ID,
        ownerUserId: user._id,
        salt: b64(b.salt, 'salt', 16, 32),
        iterations: iterationsOf(b.iterations),
        byPassphrase: lockedKeys(b.byPassphrase, 'byPassphrase'),
        recoverySalt: b64(b.recoverySalt, 'recoverySalt', 16, 32),
        byRecovery: lockedKeys(b.byRecovery, 'byRecovery'),
        publicKey,
        fingerprint: fingerprint(publicKey),
        setupAt: new Date(),
    }
    const request = await checkSignedRequest(req, publicKey)

    try {
        await OwnerKey.create(doc)          // fixed _id: only one setup can ever succeed, even two at the same moment
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) throw conflict('ALREADY_SET_UP')
        throw error
    }
    const entry = await appendOwnerLog({ action: 'setup', recordId: String(user._id), request, result: { fingerprint: doc.fingerprint } })

    let emailed = true
    try {
        await sendOwnerMail('Owner Console setup completed', [
            'The Owner Console was set up.',
            '',
            `Key fingerprint: ${doc.fingerprint}`,
            `Time:            ${fmtTime(doc.setupAt)}`,
            `Owner account:   ${user.name}`,
            '',
            'Compare the key fingerprint with the one on your screen and on your printed recovery sheet.',
            'If you did not do this setup yourself, treat it as an incident.',
        ])
    } catch (error) {
        emailed = false
        console.error('[owner] setup email failed:', error instanceof Error ? error.message : error)
    }
    res.status(201).json({ success: true, data: { fingerprint: doc.fingerprint, emailed, log: { count: entry.seq, head: entry.hash } } })
})

/* ------------------------------------------------------------------ */
/* Signed                                                              */
/* ------------------------------------------------------------------ */


// Login: proves the console holds the key by signing a one-time challenge from the server.
router.post('/login', requireOwner, async (req, res) => {
    const { challenge } = jsonBody(req)
    if (typeof challenge !== 'string') throw badRequest('challenge is required')
    const used = await OwnerNonce.findOneAndDelete({ _id: challenge, kind: 'challenge', expiresAt: { $gt: new Date() } })
    if (!used) throw unauthorized('The login challenge is unknown, expired or already used')
    const o = owner(res)
    await appendOwnerLog({ action: 'login', request: o.request, result: { ok: true } })
    res.json({ success: true, data: { fingerprint: o.key.fingerprint, serverTime: Date.now(), log: await ownerLogHead() } })
})

// New passphrase (after "Change passphrase", or after unlocking with the recovery key): new salt and newly locked keys.
router.put('/keys', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.reason !== 'change' && b.reason !== 'recovery') throw badRequest("reason must be 'change' or 'recovery'")
    const update = { salt: b64(b.salt, 'salt', 16, 32), iterations: iterationsOf(b.iterations), byPassphrase: lockedKeys(b.byPassphrase, 'byPassphrase'), passphraseChangedAt: new Date() }
    const o = owner(res)
    await OwnerKey.updateOne({ _id: OWNER_KEY_ID }, { $set: update })
    const action = b.reason === 'change' ? 'passphrase.change' : 'passphrase.reset-with-recovery-key'
    await appendOwnerLog({ action, request: o.request, result: { ok: true } })
    await sendOwnerMail(b.reason === 'change' ? 'Owner Console: passphrase changed' : 'Owner Console: passphrase reset with the recovery key', [
        b.reason === 'change' ? 'The Owner Console passphrase was changed.' : 'The Owner Console passphrase was reset using the recovery key.',
        '',
        `Key fingerprint: ${o.key.fingerprint}`,
        `Time:            ${fmtTime(update.passphraseChangedAt)}`,
        '',
        'If this was not you, treat it as an incident.',
    ]).catch(error => console.error('[owner] passphrase email failed:', error instanceof Error ? error.message : error))
    res.json({ success: true })
})

// The whole history, for "Verify everything" (reading it is not itself recorded).
router.get('/log', requireOwner, async (_req, res) => {
    const o = owner(res)
    res.json({ success: true, data: { entries: await ownerLogEntries(), publicKey: o.key.publicKey, fingerprint: o.key.fingerprint } })
})

// Owner actions (payroll, people, salary history, integrity, adopt) live in their own route files.
router.use(integrityRoutes)
router.use(payrollRoutes)

export default router
