import { NextFunction, Request, Response } from 'express'
import { badRequest, unauthorized } from '../utils/http.js'
import { checkSignedRequest, getOwnerKey, rawBodyOf } from './owner.service.js'
import { SignedRequest } from './signing.js'
import { IOwnerKey } from '../model/ownerKey.model.js'

/** The JSON body of an owner request (owner routes keep the raw bytes, see owner.routes.ts). */
export const jsonBody = (req: Request): any => {
    const raw = rawBodyOf(req)
    if (!raw.length) return {}
    try { return JSON.parse(raw.toString('utf8')) } catch { throw badRequest('Request body is not valid JSON') }
}

/** The exact signed body text, kept in the history for state-changing actions. */
export const bodyText = (req: Request) => rawBodyOf(req).toString('utf8')

// res.locals.owner = { request, key } after a good signature
export const requireOwner = async (req: Request, res: Response, next: NextFunction) => {
    const key = await getOwnerKey()
    if (!key) throw unauthorized('The Owner Console is not set up')
    res.locals.owner = { request: await checkSignedRequest(req, key.publicKey), key }
    next()
}

export const owner = (res: Response) => res.locals.owner as { request: SignedRequest; key: IOwnerKey }
