import { badRequest } from './http.js';
/**
 * Calendar days are handled as "YYYY-MM-DD" keys in the PAYROLL timezone (same one the salary cron uses),
 * so "today" means the same thing no matter which timezone the server runs in.
 */
export const payrollTimeZone = () => process.env.PAYROLL_TIMEZONE || 'Asia/Dubai';
export const dayKey = (date = new Date(), timeZone = payrollTimeZone()) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
// Midnight UTC of the calendar day. Used for the `date` field so it is the same instant everywhere.
export const keyToDate = (key) => new Date(`${key}T00:00:00.000Z`);
export const asDayKey = (value, field = 'date') => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw badRequest(`${field} must be in YYYY-MM-DD format`);
    }
    const d = keyToDate(value);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
        throw badRequest(`${field} is not a valid date`);
    }
    return value;
};
