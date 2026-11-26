import { apiClient, ApiEnvelope } from '@/lib/apiClient';
import { buildQuery } from '@/lib/utils';

/* ---------------------------------------------------------------- */
/* Types                                                             */
/* ---------------------------------------------------------------- */

export type CertificateKind = 'letter' | 'certificate';
export type CertificateStatus = 'issued' | 'revoked';
export type CertificateEmailStatus = 'not_sent' | 'sent' | 'failed';

export interface Signatory {
    name?: string;
    title?: string;
}

export interface CertificatePagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

export interface ICertificate {
    _id: string;
    referenceNo: string;
    employeeId: string;
    companyId: string;
    issuedBy: string;
    issuedByName?: string;

    typeKey: string;
    typeLabel: string;
    kind: CertificateKind;
    templateId?: string;

    // Final text (placeholders already replaced). This is what the PDF shows.
    title: string;
    subject?: string;
    body: string;
    variables?: Record<string, string>;
    issueDate: string;
    signatory: Signatory;
    // Set when a copy with the owner's signature image was emailed. The image itself is never stored.
    signedAt?: string;
    signedBy?: string;

    recipient: { name: string; email?: string; position?: string };
    companyName: string;

    status: CertificateStatus;
    revokedAt?: string;
    revokeReason?: string;

    email: {
        status: CertificateEmailStatus;
        sentAt?: string;
        lastAttemptAt?: string;
        error?: string;
    };
    createdAt: string;
    updatedAt: string;
}

// One entry of "what can be issued": a saved text or a built-in one.
export interface CertificateType {
    source: 'saved' | 'default';
    templateId: string | null;
    companyId: string | null;
    typeKey: string;
    typeLabel: string;
    kind: CertificateKind;
    title: string;
    subject: string;
    body: string;
    timesUsed: number;
    lastUsedAt: string | null;
    placeholders: string[];
    customPlaceholders: string[];
}

export interface CertificateTemplate {
    _id: string;
    typeKey: string;
    typeLabel: string;
    kind: CertificateKind;
    title: string;
    subject?: string;
    body: string;
    companyId: string | null;
    isActive: boolean;
    timesUsed: number;
    lastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
    placeholders: string[];
    customPlaceholders: string[];
}

export interface IssuePayload {
    type: string;
    title?: string;
    subject?: string;
    body?: string;
    kind?: CertificateKind;
    companyId?: string;
    issueDate?: string;
    variables?: Record<string, string>;
    signatory?: Signatory;
    sendEmail?: boolean;
    saveTemplate?: boolean;
    /** The owner's signature (base64 PNG/JPEG, max 1 MB). Only for the PDF preview, issue and bulk issue. Never stored. */
    signatureImage?: string;
}

export interface CertificatePreview {
    typeKey: string;
    typeLabel: string;
    kind: CertificateKind;
    title: string;
    subject?: string;
    body: string;
    issueDate: string;
    signatory: Signatory;
    recipient: { name: string; email?: string; position?: string };
    companyName: string;
    willRememberWording: boolean;
    placeholders: string[];
    customPlaceholders: string[];
}

export interface EmailOutcome {
    status: CertificateEmailStatus;
    error?: string;
    [key: string]: unknown;
}

export interface BulkIssueResult {
    employeeId: string;
    success: boolean;
    referenceNo?: string;
    certificateId?: string;
    email?: CertificateEmailStatus;
    error?: string;
}

export interface CertificateListParams {
    search?: string;
    companyId?: string;
    kind?: CertificateKind | '';
    status?: CertificateStatus | '';
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

export interface TemplatePayload {
    type?: string;
    kind?: CertificateKind;
    title?: string;
    subject?: string;
    body?: string;
    companyId?: string;
    isActive?: boolean;
}

/* ---------------------------------------------------------------- */
/* Admin: issue                                                      */
/* ---------------------------------------------------------------- */

export const getCertificateTypes = (token: string, companyId?: string) =>
    apiClient<ApiEnvelope<CertificateType[]>>(`/certificates/types${buildQuery({ companyId })}`, { token });

// Same body as issuing. Returns the final text without saving or emailing anything.
export const previewCertificate = (token: string, payload: IssuePayload & { employeeId: string }) =>
    apiClient<ApiEnvelope<CertificatePreview>>('/certificates/preview', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

// Same body as previewCertificate. Returns the real PDF layout; nothing is saved and no reference number is used.
export const previewCertificatePdf = (token: string, payload: IssuePayload & { employeeId: string }) =>
    apiClient<Blob>('/certificates/preview/pdf', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
        responseType: 'blob',
    });

export const issueCertificate = (token: string, payload: IssuePayload & { employeeId: string }) =>
    apiClient<ApiEnvelope<ICertificate> & { email: EmailOutcome }>('/certificates', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

export const bulkIssueCertificates = (token: string, payload: IssuePayload & { employeeIds: string[] }) =>
    apiClient<
        ApiEnvelope<BulkIssueResult[]> & {
            summary: { requested: number; issued: number; failed: number };
        }
    >('/certificates/bulk', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

/* ---------------------------------------------------------------- */
/* Read                                                              */
/* ---------------------------------------------------------------- */

// Admin: every issued document, with filters and pagination.
export const getCertificates = (token: string, params: CertificateListParams = {}) =>
    apiClient<ApiEnvelope<ICertificate[]> & { pagination: CertificatePagination }>(
        `/certificates${buildQuery({ ...params })}`,
        { token }
    );

// Any logged-in user: their own issued (not revoked) documents.
export const getMyCertificates = (token: string) =>
    apiClient<ApiEnvelope<ICertificate[]>>('/certificates/my', { token });

// The PDF needs the login token, so it is fetched as a file instead of being a plain link.
export const getCertificatePdf = (token: string, id: string) =>
    apiClient<Blob>(`/certificates/${id}/pdf?inline=true`, { token, responseType: 'blob' });

// Throws an ApiError when the email fails again.
// With signatureImage the resent copy carries the signature (memory only); without, it shows "Digitally signed by ...".
export const resendCertificateEmail = (token: string, id: string, signatureImage?: string) =>
    apiClient<ApiEnvelope & { email: EmailOutcome }>(`/certificates/${id}/resend-email`, {
        method: 'POST',
        token,
        body: JSON.stringify(signatureImage ? { signatureImage } : {}),
    });

export const revokeCertificate = (token: string, id: string, reason?: string) =>
    apiClient<ApiEnvelope<ICertificate>>(`/certificates/${id}/revoke`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ reason: reason?.trim() || undefined }),
    });

/* ---------------------------------------------------------------- */
/* Saved texts (templates)                                           */
/* ---------------------------------------------------------------- */

export const getCertificateTemplates = (token: string, params: { companyId?: string; all?: boolean } = {}) =>
    apiClient<ApiEnvelope<CertificateTemplate[]>>(`/certificates/templates${buildQuery({ ...params })}`, { token });

export const createCertificateTemplate = (token: string, payload: TemplatePayload) =>
    apiClient<ApiEnvelope<CertificateTemplate>>('/certificates/templates', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

export const updateCertificateTemplate = (token: string, id: string, payload: TemplatePayload) =>
    apiClient<ApiEnvelope<CertificateTemplate>>(`/certificates/templates/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });

export const deleteCertificateTemplate = (token: string, id: string) =>
    apiClient<ApiEnvelope>(`/certificates/templates/${id}`, { method: 'DELETE', token });

/* ---------------------------------------------------------------- */
/* Placeholders                                                      */
/* ---------------------------------------------------------------- */

// Filled in by the system. Same list as the backend (AUTO_VARIABLES).
export const AUTO_VARIABLES = [
    'employeeName', 'employeeEmail', 'position',
    'companyName', 'companyLegalName',
    'issueDate', 'joiningDate',
    'salary', 'currency',
    'signatoryName', 'signatoryTitle',
] as const;

/*
 * Same rules as backend/src/utils/placeholders.ts: keep the two in step.
 * A placeholder is {{name}} (spaces allowed inside the brackets) where the name starts with a lowercase
 * letter and is 2 to 40 letters, digits or _. Old saved texts may use names that start with a capital
 * letter: those are accepted only when they come from that stored text (`legacy`), never when typed.
 * Anything else in {{ }}, or a stray {{ or }}, is broken and blocks preview and issue.
 */
const PLACEHOLDER_NAME = /^[a-z][a-zA-Z0-9_]{1,39}$/;
const LEGACY_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const TOKEN = /\{\{([^{}]*)\}\}/g;
const STRAY = /\{\{[^\s{}]{0,30}|[^\s{}]{0,30}\}\}/g;

export interface PlaceholderScan {
    names: string[];
    broken: string[];
}

/** Old-style names in a stored text; they stay valid for that text. */
export const legacyNames = (...texts: (string | undefined)[]): string[] => {
    const found = new Set<string>();
    for (const text of texts) {
        for (const m of (text ?? '').matchAll(TOKEN)) {
            const name = m[1].trim();
            if (LEGACY_NAME.test(name) && !PLACEHOLDER_NAME.test(name)) found.add(name);
        }
    }
    return [...found];
};

export const isValidPlaceholder = (name: string, legacy: readonly string[] = []) =>
    PLACEHOLDER_NAME.test(name) || legacy.includes(name);

export const scanPlaceholders = (texts: (string | undefined)[], legacy: readonly string[] = []): PlaceholderScan => {
    const names = new Set<string>();
    const broken = new Set<string>();
    for (const text of texts) {
        if (!text) continue;
        const rest = text.replace(TOKEN, (all, inner: string) => {
            const name = inner.trim();
            if (isValidPlaceholder(name, legacy)) names.add(name);
            else broken.add(all.length > 44 ? `${all.slice(0, 40)}...}}` : all);
            return ' ';
        });
        for (const m of rest.matchAll(STRAY)) broken.add(m[0]);
    }
    return { names: [...names], broken: [...broken] };
};

export const brokenPlaceholderMessage = (broken: string[]) =>
    `This text has ${broken.length === 1 ? 'a broken placeholder' : 'broken placeholders'}: ${broken.slice(0, 5).join(', ')}. `
    + 'Use {{employeeName}}, or type the text without curly brackets.';

/** Splits a text into plain parts and placeholder parts, for highlighting. */
export type PlaceholderPart = { text: string; kind: 'plain' | 'valid' | 'broken' };
export const splitPlaceholders = (text: string, legacy: readonly string[] = []): PlaceholderPart[] => {
    const parts: PlaceholderPart[] = [];
    const push = (t: string, kind: PlaceholderPart['kind']) => { if (t) parts.push({ text: t, kind }); };
    const markStray = (t: string) => {
        let last = 0;
        for (const m of t.matchAll(/\{\{|\}\}/g)) {
            push(t.slice(last, m.index), 'plain');
            push(m[0], 'broken');
            last = (m.index ?? 0) + m[0].length;
        }
        push(t.slice(last), 'plain');
    };
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
        markStray(text.slice(last, m.index));
        push(m[0], isValidPlaceholder(m[1].trim(), legacy) ? 'valid' : 'broken');
        last = (m.index ?? 0) + m[0].length;
    }
    markStray(text.slice(last));
    return parts;
};

export const isAutoVariable = (name: string) => (AUTO_VARIABLES as readonly string[]).includes(name);

// "courseName" -> "Course name"
export const humanizeVariable = (name: string) => {
    const spaced = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// The backend answers 'Missing values for: salary, endDate. Send them in "variables"...'
export const parseMissingVariables = (message: string): string[] => {
    const match = message.match(/Missing values for:\s*([^.]+)\./i);
    if (!match) return [];
    return match[1].split(',').map(s => s.trim()).filter(Boolean);
};

/* ---------------------------------------------------------------- */
/* Download helper                                                   */
/* ---------------------------------------------------------------- */

export const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
