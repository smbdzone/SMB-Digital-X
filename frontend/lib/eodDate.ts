/**
 * EOD calendar days.
 *
 * The backend decides "today" in the PAYROLL timezone (PAYROLL_TIMEZONE, default Asia/Dubai) and stores
 * every report with a `dateKey` ("YYYY-MM-DD"). The browser's own timezone must never decide which day
 * a report belongs to, so every EOD screen uses these helpers instead of `new Date()`.
 *
 * If your backend PAYROLL_TIMEZONE is not Asia/Dubai, set the same value in the frontend env:
 *   NEXT_PUBLIC_PAYROLL_TIMEZONE=Your/Zone
 */
const DEFAULT_TIME_ZONE = 'Asia/Dubai';

const buildFormatter = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

export const payrollTimeZone = (): string => process.env.NEXT_PUBLIC_PAYROLL_TIMEZONE || DEFAULT_TIME_ZONE;

// Today's "YYYY-MM-DD" in the payroll timezone.
export const todayKey = (): string => {
    try {
        return buildFormatter(payrollTimeZone()).format(new Date());
    } catch {
        // invalid timezone name in the env
        return buildFormatter(DEFAULT_TIME_ZONE).format(new Date());
    }
};

// "2026-10-27" + (-1) -> "2026-10-26"
export const shiftDayKey = (key: string, days: number): string => {
    const date = new Date(`${key}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

// `dateKey` when present; old reports fall back to `date`, which is midnight UTC of the same day.
export const reportDayKey = (report: { dateKey?: string; date?: string }): string => {
    if (report.dateKey) return report.dateKey;
    if (!report.date) return '';
    const date = new Date(report.date);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

// "2026-10-27" -> "27 Oct 2026" (no timezone shift, it is a calendar day)
export const formatDayKey = (key?: string | null): string => {
    if (!key) return '-';
    const date = new Date(`${key}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
