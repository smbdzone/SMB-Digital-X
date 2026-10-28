import mongoose from 'mongoose';
import { round2 } from './money.js';
/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */
export class AppError extends Error {
    status;
    details;
    constructor(status, message, details) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.details = details;
    }
}
export const badRequest = (message, details) => new AppError(400, message, details);
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, message);
export const notFound = (message = 'Not found') => new AppError(404, message);
export const conflict = (message) => new AppError(409, message);
// `isVerified` puts { id, role } from the JWT on req.user.
export const getAuth = (req) => {
    const user = req.user;
    if (!user?.id)
        throw unauthorized();
    return { id: String(user.id), role: String(user.role ?? 'employee') };
};
export const isAdmin = (auth) => auth.role === 'admin';
/* ------------------------------------------------------------------ */
/* Input parsing / validation                                          */
/* ------------------------------------------------------------------ */
export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) && mongoose.Types.ObjectId.isValid(value);
export const paramId = (req, name = 'id') => {
    const raw = req.params[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!isObjectId(value))
        throw badRequest(`Invalid ${name}`);
    return value;
};
export const asObjectId = (value, field) => {
    if (!isObjectId(value))
        throw badRequest(`${field} is not a valid id`);
    return new mongoose.Types.ObjectId(value);
};
// Only accept plain, non-empty strings from query strings (ignores arrays / objects).
export const queryString = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
export const parsePagination = (query, defaultLimit = 50, maxLimit = 200) => {
    const page = Math.max(1, parseInt(String(queryString(query.page) ?? '1'), 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(String(queryString(query.limit) ?? defaultLimit), 10) || defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
};
export const asMonth = (value, field = 'month') => {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        throw badRequest(`${field} must be in YYYY-MM format`);
    }
    return value;
};
export const asAmount = (value, field, opts = {}) => {
    const min = opts.min ?? 0;
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) {
        throw badRequest(`${field} must be a number greater than or equal to ${min}`);
    }
    return round2(n);
};
export const asPercent = (value, field) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) {
        throw badRequest(`${field} must be a number between 0 and 100`);
    }
    return n;
};
export const asCurrency = (value, field = 'currency') => {
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
        throw badRequest(`${field} must be a 3-letter currency code (e.g. AED, USD)`);
    }
    return value.trim().toUpperCase();
};
export const asDate = (value, field = 'date') => {
    const d = value instanceof Date ? value : new Date(String(value));
    if (typeof value === 'undefined' || value === null || Number.isNaN(d.getTime())) {
        throw badRequest(`${field} is not a valid date`);
    }
    return d;
};
export function asText(value, field, opts = {}) {
    const max = opts.max ?? 500;
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        if (opts.required)
            throw badRequest(`${field} is required`);
        return undefined;
    }
    if (typeof value !== 'string')
        throw badRequest(`${field} must be text`);
    const text = value.trim();
    if (text.length > max)
        throw badRequest(`${field} must be at most ${max} characters`);
    return text;
}
export const asEmail = (value, field) => {
    const text = asText(value, field, { max: 254 });
    if (text === undefined)
        return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
        throw badRequest(`${field} is not a valid email address`);
    return text;
};
// [{ name, amount }] used for allowances and deductions.
export const asLineItems = (value, field) => {
    if (!Array.isArray(value))
        throw badRequest(`${field} must be an array`);
    if (value.length > 50)
        throw badRequest(`${field} has too many items`);
    return value.map((item, i) => {
        if (typeof item !== 'object' || item === null)
            throw badRequest(`${field}[${i}] is invalid`);
        return {
            name: asText(item.name, `${field}[${i}].name`, { required: true, max: 100 }),
            amount: asAmount(item.amount, `${field}[${i}].amount`),
        };
    });
};
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
