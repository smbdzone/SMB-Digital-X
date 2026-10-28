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
    signature?: string;
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
    body: string;
    variables?: Record<string, string>;
    issueDate: string;
    signatory: Signatory;

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
    body?: string;
    kind?: CertificateKind;
    companyId?: string;
    issueDate?: string;
    variables?: Record<string, string>;
    signatory?: Signatory;
    sendEmail?: boolean;
    saveTemplate?: boolean;
}

export interface CertificatePreview {
    typeKey: string;
    typeLabel: string;
    kind: CertificateKind;
    title: string;
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
export const resendCertificateEmail = (token: string, id: string) =>
    apiClient<ApiEnvelope & { email: EmailOutcome }>(`/certificates/${id}/resend-email`, {
        method: 'POST',
        token,
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

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export const findPlaceholders = (...texts: string[]): string[] => {
    const found = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(PLACEHOLDER)) found.add(match[1]);
    }
    return [...found];
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
