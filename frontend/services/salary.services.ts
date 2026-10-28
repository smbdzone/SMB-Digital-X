import { apiClient, ApiEnvelope } from '@/lib/apiClient';
import { buildQuery } from '@/lib/utils';

export interface SalaryEmployee {
    _id: string;
    name: string;
    email: string;
    position?: string;
}

export interface LineItem {
    name: string;
    amount: number;
}

export interface PaymentDetails {
    method?: string;
    bankName?: string;
    holderName?: string;
    accountNumber?: string;
    iban?: string;
    reference?: string;
}

export interface SalaryCompanyRef {
    _id: string;
    name: string;
    code: string;
    logo: string;
    brandColor?: string;
}

// Added by the backend next to the populated `companyId` (logo is already a full URL).
export interface SalaryCompanySummary {
    id: string;
    name: string;
    code: string;
    logo: string;
    brandColor?: string;
}

export type EmailStatus = 'not_sent' | 'sent' | 'failed';

export interface ISalary {
    _id: string;
    employeeId: SalaryEmployee | string;
    companyId: SalaryCompanyRef | string;
    company?: SalaryCompanySummary;
    month: string;
    currency: string;

    salary: number;
    allowances: LineItem[];
    deductions: LineItem[];
    totalAllowances: number;
    totalDeductions: number;
    grossAmount: number;
    netPay: number;

    status: 'pending' | 'paid';
    paidOn?: string;
    paidBy?: { _id: string; name: string } | string;
    paidByName?: string;
    paymentDetails?: PaymentDetails;

    email?: {
        status: EmailStatus;
        sentAt?: string;
        attempts: number;
        lastError?: string;
    };

    notes?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Pagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

export interface SalarySummaryRow {
    currency: string;
    status: 'pending' | 'paid';
    count: number;
    netPay: number;
}

export interface EmailOutcome {
    status: EmailStatus;
    error?: string;
    [key: string]: unknown;
}

export interface SalaryListParams {
    month?: string;
    status?: 'pending' | 'paid' | '';
    companyId?: string;
    employeeId?: string;
    page?: number;
    limit?: number;
}

export type SalaryListResponse = ApiEnvelope<ISalary[]> & {
    pagination: Pagination;
    summary: SalarySummaryRow[];
};

export interface UpdateSalaryPayload {
    salary?: number;
    allowances?: LineItem[];
    deductions?: LineItem[];
    currency?: string;
    companyId?: string;
    notes?: string;
    status?: 'pending' | 'paid';
    // payment details, only used together with status: 'paid'
    paymentMethod?: string;
    bankName?: string;
    holderName?: string;
    accountNumber?: string;
    iban?: string;
    paymentReference?: string;
}

// Admin: payroll list with filters, pagination and per-currency totals.
export const getSalaries = (token: string, params: SalaryListParams = {}) =>
    apiClient<SalaryListResponse>(`/salary${buildQuery({ ...params })}`, { token });

// Employee: own PAID slips (account numbers are masked by the backend).
export const getMySalaries = (token: string, month?: string) =>
    apiClient<ApiEnvelope<ISalary[]>>(`/salary/my${buildQuery({ month })}`, { token });

export const getSalary = (token: string, id: string) =>
    apiClient<ApiEnvelope<ISalary>>(`/salary/${id}`, { token });

export const updateSalary = (token: string, id: string, payload: UpdateSalaryPayload) =>
    apiClient<ApiEnvelope<ISalary> & { email: EmailOutcome | null }>(`/salary/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });

export interface GenerateResult {
    month: string;
    created: number;
    alreadyExisted: number;
    skipped: { employeeId: string; name: string; reason: string }[];
}

export const generateSalaries = (token: string, payload: { month?: string; companyId?: string }) =>
    apiClient<ApiEnvelope<GenerateResult>>('/salary/generate', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

export interface BulkPayResult {
    total: number;
    paid: number;
    emailsSent: number;
    emailsFailed: number;
    [key: string]: unknown;
}

export const bulkPaySalaries = (
    token: string,
    payload: { month: string; companyId?: string; salaryIds?: string[] }
) =>
    apiClient<ApiEnvelope<BulkPayResult>>('/salary/bulk-pay', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });

// Throws an ApiError (502) with the SMTP reason when the email fails again.
export const resendSalaryEmail = (token: string, id: string) =>
    apiClient<ApiEnvelope & { email: EmailOutcome }>(`/salary/${id}/resend-email`, {
        method: 'POST',
        token,
    });

/* helpers */
export const salaryEmployee = (s: ISalary): SalaryEmployee | null =>
    typeof s.employeeId === 'string' ? null : s.employeeId;

export const salaryCompanyId = (s: ISalary): string =>
    typeof s.companyId === 'string' ? s.companyId : s.companyId?._id ?? '';

export const salaryCompanyName = (s: ISalary): string =>
    s.company?.name ?? (typeof s.companyId === 'object' ? s.companyId?.name : '') ?? '';

export const salaryCompanyLogo = (s: ISalary): string => s.company?.logo ?? '';
