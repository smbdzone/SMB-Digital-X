import { Request } from 'express'
import mongoose from 'mongoose'
import { round2 } from './money.js'

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class AppError extends Error {
    status: number
    details?: unknown

    constructor(status: number, message: string, details?: unknown) {
        super(message)
        this.name = 'AppError'
        this.status = status
        this.details = details
    }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, details)
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message)
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, message)
export const notFound = (message = 'Not found') => new AppError(404, message)
export const conflict = (message: string) => new AppError(409, message)

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */

export interface AuthUser {
    id: string
    role: string
}

// `isVerified` puts { id, role } from the JWT on req.user.
export const getAuth = (req: Request): AuthUser => {
    const user = (req as any).user
    if (!user?.id) throw unauthorized()
    return { id: String(user.id), role: String(user.role ?? 'employee') }
}

export const isAdmin = (auth: AuthUser): boolean => auth.role === 'admin'

/* ------------------------------------------------------------------ */
/* Input parsing / validation                                          */
/* ------------------------------------------------------------------ */

export const isObjectId = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) && mongoose.Types.ObjectId.isValid(value)

export const paramId = (req: Request, name = 'id'): string => {
    const raw = req.params[name]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (!isObjectId(value)) throw badRequest(`Invalid ${name}`)
    return value
}

export const asObjectId = (value: unknown, field: string): mongoose.Types.ObjectId => {
    if (!isObjectId(value)) throw badRequest(`${field} is not a valid id`)
    return new mongoose.Types.ObjectId(value)
}

// Only accept plain, non-empty strings from query strings (ignores arrays / objects).
export const queryString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

export const parsePagination = (query: Request['query'], defaultLimit = 50, maxLimit = 200) => {
    const page = Math.max(1, parseInt(String(queryString(query.page) ?? '1'), 10) || 1)
    const limit = Math.min(maxLimit, Math.max(1, parseInt(String(queryString(query.limit) ?? defaultLimit), 10) || defaultLimit))
    return { page, limit, skip: (page - 1) * limit }
}

export const asMonth = (value: unknown, field = 'month'): string => {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        throw badRequest(`${field} must be in YYYY-MM format`)
    }
    return value
}

export const asAmount = (value: unknown, field: string, opts: { min?: number } = {}): number => {
    const min = opts.min ?? 0
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) {
        throw badRequest(`${field} must be a number greater than or equal to ${min}`)
    }
    return round2(n)
}

export const asPercent = (value: unknown, field: string): number => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
        throw badRequest(`${field} must be a number between 0 and 100`)
    }
    return n
}

export const asCurrency = (value: unknown, field = 'currency'): string => {
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
        throw badRequest(`${field} must be a 3-letter currency code (e.g. AED, USD)`)
    }
    return value.trim().toUpperCase()
}

export const asDate = (value: unknown, field = 'date'): Date => {
    const d = value instanceof Date ? value : new Date(String(value))
    if (typeof value === 'undefined' || value === null || Number.isNaN(d.getTime())) {
        throw badRequest(`${field} is not a valid date`)
    }
    return d
}

export function asText(value: unknown, field: string, opts: { required: true; max?: number }): string
export function asText(value: unknown, field: string, opts?: { required?: false; max?: number }): string | undefined
export function asText(value: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
    const max = opts.max ?? 500
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        if (opts.required) throw badRequest(`${field} is required`)
        return undefined
    }
    if (typeof value !== 'string') throw badRequest(`${field} must be text`)
    const text = value.trim()
    if (text.length > max) throw badRequest(`${field} must be at most ${max} characters`)
    return text
}

export const asEmail = (value: unknown, field: string): string | undefined => {
    const text = asText(value, field, { max: 254 })
    if (text === undefined) return undefined
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw badRequest(`${field} is not a valid email address`)
    return text
}

// [{ name, amount }] used for allowances and deductions.
export const asLineItems = (value: unknown, field: string): { name: string; amount: number }[] => {
    if (!Array.isArray(value)) throw badRequest(`${field} must be an array`)
    if (value.length > 50) throw badRequest(`${field} has too many items`)
    return value.map((item, i) => {
        if (typeof item !== 'object' || item === null) throw badRequest(`${field}[${i}] is invalid`)
        return {
            name: asText((item as any).name, `${field}[${i}].name`, { required: true, max: 100 }),
            amount: asAmount((item as any).amount, `${field}[${i}].amount`),
        }
    })
}

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
