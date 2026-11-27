import { NextFunction, Request, Response } from 'express'
import { badRequest, unauthorized } from '../utils/http.js'
import { assertOwnerLogProtected } from './ownerLogIndex.js'
import { takeOwnerWriteLock } from './ownerWriteLock.js'
import { attachmentOf, checkSignedRequest, getOwnerKey, signedBodyOf } from './owner.service.js'
import { sha256Hex } from './signing.js'
import { SignedRequest } from './signing.js'
import { IOwnerKey } from '../model/ownerKey.model.js'

/** The JSON body of an owner request (owner routes keep the raw bytes, see owner.routes.ts). */
export const jsonBody = (req: Request): any => {
    const raw = signedBodyOf(req)
    if (!raw.length) return {}
    try { return JSON.parse(raw.toString('utf8')) } catch { throw badRequest('Request body is not valid JSON') }
}

/** The exact signed body text, kept in the history for state-changing actions. */
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
    next()
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
