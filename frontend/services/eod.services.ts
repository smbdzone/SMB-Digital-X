import { apiClient, ApiEnvelope } from "@/lib/apiClient";
import { buildQuery } from "@/lib/utils";


// ========================================
// Types
// ========================================

export type EODStatus = "Submitted" | "Reviewed";

export interface EODTask {
    _id: string;
    title: string;
    status?: string;
    progress?: number;
}

export interface EODEmployee {
    _id: string;
    name: string;
    email: string;
    position?: string;
    companyId?: string;
}

export interface EODPagination {
    page: number;
    limit: number;
    total: number;
    pages: number;
}

export interface EODReport {
    _id: string;

    employeeId: EODEmployee | string;

    // "YYYY-MM-DD" in the payroll timezone. This is the day the report belongs to.
    dateKey: string;

    // Midnight UTC of dateKey (kept by the backend for old code). Prefer dateKey.
    date: string;

    summary: string;

    completedTasks: EODTask[];

    inProgressTasks: EODTask[];

    blockers: string;

    tomorrowPlan: string;

    overallProgress: number;

    status: EODStatus;

    reviewedBy?: EODEmployee | null;

    reviewedAt?: string | null;

    reviewNote?: string;

    createdAt: string;

    updatedAt: string;
}

export type EODListResponse = ApiEnvelope<EODReport[]> & {
    pagination?: EODPagination;
};

export interface MissingEODData {
    date: string;
    totalEmployees: number;
    submitted: number;
    missingCount: number;
    missing: EODEmployee[];
}


// ========================================
// Submit EOD
// Employee
// POST /eod
// ========================================

export interface SubmitEODPayload {
    summary: string;

    completedTasks: string[];

    inProgressTasks: string[];

    blockers?: string;

    tomorrowPlan?: string;

    overallProgress: number;
}

export const submitEOD = (
    token: string,
    payload: SubmitEODPayload
) => {
    return apiClient<ApiEnvelope<EODReport>>(
        "/eod",
        {
            method: "POST",
            token,
            body: JSON.stringify(payload),
        }
    );
};


// ========================================
// Update EOD
// Employee (owner, today only, until reviewed)
// PATCH /eod/:id
// ========================================

export type UpdateEODPayload = Partial<SubmitEODPayload>;

export const updateEOD = (
    id: string,
    token: string,
    payload: UpdateEODPayload
) => {
    return apiClient<ApiEnvelope<EODReport>>(
        `/eod/${id}`,
        {
            method: "PATCH",
            token,
            body: JSON.stringify(payload),
        }
    );
};


// ========================================
// Fetch Employee EOD
// GET /eod/my?from=&to=&status=&page=&limit=
// from / to are "YYYY-MM-DD" day keys
// ========================================

export interface EmployeeEODParams {
    from?: string;
    to?: string;
    status?: EODStatus;
    page?: number;
    limit?: number;
}

export const fetchEmployeeEOD = (
    token: string,
    params: EmployeeEODParams = {}
) => {
    return apiClient<EODListResponse>(
        `/eod/my${buildQuery({ ...params })}`,
        {
            token,
        }
    );
};


// ========================================
// Fetch All EOD
// Admin
// GET /eod?date= or from=&to= &employeeId=&companyId=&status=&page=&limit=
// (no date at all = today on the server)
// ========================================

export interface AllEODParams {
    date?: string;
    from?: string;
    to?: string;
    employeeId?: string;
    companyId?: string;
    status?: EODStatus;
    page?: number;
    limit?: number;
}

export const fetchAllEOD = (
    token: string,
    params: AllEODParams = {}
) => {
    return apiClient<EODListResponse>(
        `/eod${buildQuery({ ...params })}`,
        {
            token,
        }
    );
};


// ========================================
// Employees without a report
// Admin
// GET /eod/missing?date=&companyId=
// ========================================

export const fetchMissingEOD = (
    token: string,
    params: { date?: string; companyId?: string } = {}
) => {
    return apiClient<ApiEnvelope<MissingEODData>>(
        `/eod/missing${buildQuery({ ...params })}`,
        {
            token,
        }
    );
};


// ========================================
// Fetch Single EOD
// GET /eod/:id
// ========================================

export const fetchSingleEOD = (
    id: string,
    token: string
) => {
    return apiClient<ApiEnvelope<EODReport>>(
        `/eod/${id}`,
        {
            token,
        }
    );
};


// ========================================
// Review EOD
// Admin (not own report, first reviewer wins)
// PATCH /eod/:id/review   { reviewNote? }
// ========================================

export const reviewEOD = (
    id: string,
    token: string,
    reviewNote?: string
) => {
    return apiClient<ApiEnvelope<EODReport>>(
        `/eod/${id}/review`,
        {
            method: "PATCH",
            token,
            body: JSON.stringify({ reviewNote: reviewNote?.trim() || undefined }),
        }
    );
};
