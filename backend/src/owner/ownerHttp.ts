import { NextFunction, Request, Response } from 'express'
import { badRequest, unauthorized } from '../utils/http.js'
import { assertOwnerLogProtected } from './ownerLogIndex.js'
import { takeOwnerWriteLock } from './ownerWriteLock.js'
import { attachmentOf, checkSignedRequest, getOwnerKey, innerOf, signedBodyOf } from './owner.service.js'
import { canonicalJson, historyIndex, outerBodyOf } from './ownerState.js'
import { isLocked, vaultStarted } from './vault.js'
import { sha256Hex } from './signing.js'
import { SignedRequest } from './signing.js'
import { IOwnerKey } from '../model/ownerKey.model.js'

/** The JSON body of an owner request (owner routes keep the raw bytes, see owner.routes.ts); for a Phase 2 request, the inner body. */
export const jsonBody = (req: Request): any => {
    const raw = (req as any).ownerInnerChecked ? innerOf(req)! : signedBodyOf(req)
    if (!raw.length) return {}
    try { return JSON.parse(raw.toString('utf8')) } catch { throw badRequest('Request body is not valid JSON') }
}

/** The exact signed body text, kept in the history for state-changing actions (for a Phase 2 request: the outer body, no plain contents). */
export const bodyText = (req: Request) => signedBodyOf(req).toString('utf8')

// res.locals.owner = { request, key } after a good signature
export const requireOwner = async (req: Request, res: Response, next: NextFunction) => {
    // Before anything else: without the history's unique index no owner action may run (it could fork the chain).
    await assertOwnerLogProtected()
    const key = await getOwnerKey()
    if (!key) throw unauthorized('The Owner Console is not set up')
    res.locals.owner = { request: await checkSignedRequest(req, key.publicKey), key }
    // State-changing requests take the owner write lock (held in the database, across processes); reads stay parallel.
    if (req.method !== 'GET') await takeOwnerWriteLock(res, `${req.method} ${req.originalUrl}`.slice(0, 200))
    // After the lock: "has locking started?" cannot change while this request runs.
    await checkBodyForm(req)
    next()
}

/*
 * Phase 2 body form. Once locking has started (a signed "vault.start" entry exists), every request with a body must be
 * the outer form { v: 2, action, index, inner: { sha256, locked } } with the plain inner body sent next to it (not stored).
 * Checked here, before any route: the inner body matches its signed hash, the actions agree, and the signed index is
 * exactly what the inner body says. The routes then read the inner body (jsonBody) and the history keeps only the outer.
 * Exceptions (their bodies are never stored, or hold nothing to lock): login (a one-time challenge), the key update
 * (the keys are already locked; also used by "Forgot passphrase", before the console knows locking started), and the
 * batch that moves old history bodies (entry numbers, hashes and indexes only).
 */
const PLAIN_ALLOWED_AFTER_START = new Set(['/api/owner/login', '/api/owner/keys', '/api/owner/vault/lock-history'])
export const OLD_CONSOLE = 'Locking has started: this action must come with its body locked. Use Owner Console v1.3.0 or later.'

const checkBodyForm = async (req: Request) => {
    const text = signedBodyOf(req).toString('utf8')
    if (!text.length) return
    const outer = outerBodyOf(text)
    if (!outer) {
        if (req.method !== 'GET' && !PLAIN_ALLOWED_AFTER_START.has(req.originalUrl.split('?')[0]) && await vaultStarted()) throw badRequest(OLD_CONSOLE)
        return
    }
    const keys = Object.keys(outer).sort().join(','), innerKeys = Object.keys(outer.inner).sort().join(',')
    if (keys !== 'action,index,inner,v' || innerKeys !== 'locked,sha256' || typeof outer.action !== 'string') throw badRequest('Malformed locked request')
    if (!isLocked(outer.inner.locked)) throw badRequest('The locked body is not in a known format')
    const inner = innerOf(req)
    if (!inner?.length || sha256Hex(inner) !== outer.inner.sha256) throw unauthorized('The request body does not match the signed request')
    let body: any
    try { body = JSON.parse(inner.toString('utf8')) } catch { throw badRequest('Request body is not valid JSON') }
    if (String(body?.action ?? '') !== outer.action) throw badRequest('The signed action does not match the request body')
    let expected: string
    try { expected = canonicalJson(historyIndex(body)) } catch { throw badRequest('Request body is not valid') }
    if (canonicalJson(outer.index) !== expected) throw badRequest('The signed index does not match the request body')
    ;(req as any).ownerInnerChecked = true
}

export const owner = (res: Response) => res.locals.owner as { request: SignedRequest; key: IOwnerKey }

/**
 * The attachment of this request (signature image, logo), only if its SHA-256 equals `expectedSha256` from the signed
 * body. undefined when none was sent and none was signed. The caller wipes it (wipeOwnerRequest) when done.
 */
export const signedAttachment = (req: Request, expectedSha256: unknown): Buffer | undefined => {
    const att = attachmentOf(req)
    if (expectedSha256 === undefined || expectedSha256 === null) {
        if (att?.length) throw badRequest('An attachment was sent that the signed request does not mention')
        return undefined
    }
    if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) throw badRequest('The attachment hash must be a SHA-256 in hex')
    if (!att?.length) throw badRequest('The signed request names an attachment that was not sent')
    if (sha256Hex(att) !== expectedSha256) { att.fill(0); throw unauthorized('The attachment does not match the signed request') }
    return att
}
