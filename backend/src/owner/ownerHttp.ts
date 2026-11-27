import { NextFunction, Request, Response } from 'express'
import { badRequest, unauthorized } from '../utils/http.js'
import { assertOwnerLogProtected } from './ownerLogIndex.js'
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
    if (req.method !== 'GET') await ownerWriteTurn(res)
    next()
}

/*
 * State-changing owner requests run one at a time (in this backend process): each writes its records and then appends
 * its history entry before the next one starts. Otherwise two signed edits of the same record could interleave
 * (A writes, B writes, B logs, A logs) and the history's latest entry would no longer match what is stored.
 * Reads stay parallel; their history entries are safe through the unique seq index (appendOwnerLog retries).
 * The turn ends when the response is finished or the connection closes, whatever happened.
 */
let ownerWriteQueue: Promise<void> = Promise.resolve()
const ownerWriteTurn = (res: Response): Promise<void> => {
    let release!: () => void
    const done = new Promise<void>(resolve => { release = resolve })
    const previous = ownerWriteQueue
    ownerWriteQueue = previous.then(() => done)
    let released = false
    const end = () => { if (!released) { released = true; release() } }
    res.once('finish', end)
    res.once('close', end)
    return previous
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
