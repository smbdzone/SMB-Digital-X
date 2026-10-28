import { apiClient, ApiEnvelope } from "@/lib/apiClient";
import { buildQuery } from "@/lib/utils";
import type { Pagination } from "@/services/salary.services";

export const EXPENSE_CATEGORIES = [
    "Hosting", "Software", "Domain", "Travel", "Marketing",
    "Office", "Equipment", "Utilities", "Rent", "Other",
] as const;

export const EXPENSE_STATUSES = ["pending", "approved", "rejected", "reimbursed"] as const;

export const PAYMENT_METHODS = [
    { value: "cash", label: "Cash" },
    { value: "card", label: "Card" },
    { value: "bank_transfer", label: "Bank transfer" },
    { value: "cheque", label: "Cheque" },
    { value: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export interface ExpenseTax {
    name: string;
    percentage: number;
    amount?: number;
}

export interface ExpenseReceipt {
    _id: string;
    url: string;
    public_id: string;
    resource_type: string;
    originalName?: string;
    uploadedAt: string;
}

export interface Expense {
    _id: string;
    companyId?: string | { _id: string; name: string; code: string };
    // optional now: rent / utilities have no project
    projectId?: null | string | { _id: string; name: string; clientName?: string };
    addedBy?: string | { _id: string; name: string; email: string };

    description: string;
    category: ExpenseCategory | string;
    vendor?: string;
    paymentMethod?: string;

    amount: number;
    taxes: ExpenseTax[];
    totalTax: number;
    totalAmount: number;

    currency: string;
    date: string;
    notes?: string;

    status: ExpenseStatus;
    approvedAt?: string;
    rejectionReason?: string;

    receipts: ExpenseReceipt[];

    createdAt: string;
    updatedAt: string;
}

export interface CurrencyTotal {
    currency: string;
    total: number;
    count: number;
}

export interface ExpenseListData {
    expenses: Expense[];
    // null when the results mix currencies, use totalsByCurrency instead
    totalExpense: number | null;
    totalsByCurrency: CurrencyTotal[];
}

export type ExpenseListResponse = ApiEnvelope<ExpenseListData> & { pagination: Pagination };

export interface ExpenseFilters {
    projectId?: string;
    companyId?: string;
    category?: string;
    status?: string;
    currency?: string;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export interface CreateExpensePayload {
    projectId?: string;
    companyId?: string;
    description: string;
    category: string;
    vendor?: string;
    paymentMethod?: string;
    amount: number;
    taxes: { name: string; percentage: number }[];
    currency: string;
    date: string;
    notes?: string;
}

export const createExpense = (token: string, payload: CreateExpensePayload) =>
    apiClient<ApiEnvelope<Expense>>("/expenses", {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });

// Admin: all expenses. Employee: only their own.
export const fetchExpenses = (token: string, filters: ExpenseFilters = {}) =>
    apiClient<ExpenseListResponse>(`/expenses${buildQuery({ ...filters })}`, { token });

// Only `page` / `limit` are honoured by this endpoint.
export const fetchProjectExpenses = (
    token: string,
    projectId: string,
    filters: Pick<ExpenseFilters, "page" | "limit"> = {}
) =>
    apiClient<ExpenseListResponse>(
        `/expenses/project/${projectId}${buildQuery({ ...filters })}`,
        { token }
    );

export const fetchExpense = (token: string, id: string) =>
    apiClient<ApiEnvelope<Expense>>(`/expenses/${id}`, { token });

// Note: the project of an existing expense cannot be changed.
export const updateExpense = (
    token: string,
    id: string,
    payload: Partial<Omit<CreateExpensePayload, "projectId">>
) =>
    apiClient<ApiEnvelope<Expense>>(`/expenses/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });

// Admin only. A reason is required when rejecting.
export const updateExpenseStatus = (
    token: string,
    id: string,
    payload: { status: ExpenseStatus; reason?: string }
) =>
    apiClient<ApiEnvelope<Expense>>(`/expenses/${id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });

// Soft delete (admin only).
export const deleteExpense = (token: string, id: string) =>
    apiClient<ApiEnvelope<null>>(`/expenses/${id}`, { method: "DELETE", token });

// jpg / png / webp / pdf, max 5 per expense. Returns the full receipts array.
export const uploadReceipt = (token: string, id: string, file: File) => {
    const body = new FormData();
    body.append("receipt", file);
    return apiClient<ApiEnvelope<ExpenseReceipt[]>>(`/expenses/${id}/receipts`, {
        method: "POST",
        token,
        body,
    });
};

export const deleteReceipt = (token: string, id: string, receiptId: string) =>
    apiClient<ApiEnvelope<ExpenseReceipt[]>>(`/expenses/${id}/receipts/${receiptId}`, {
        method: "DELETE",
        token,
    });

/* helpers (projectId can be null now, never read `.name` without these) */
export const expenseProject = (e: Expense): { id: string; name: string } | null => {
    const p = e.projectId;
    if (!p) return null;
    if (typeof p === "string") return { id: p, name: "" };
    return { id: p._id, name: p.name };
};

export const expenseCompanyName = (e: Expense): string =>
    e.companyId && typeof e.companyId === "object" ? e.companyId.name : "";

export const expenseCompanyId = (e: Expense): string =>
    !e.companyId ? "" : typeof e.companyId === "string" ? e.companyId : e.companyId._id;

export const expenseOwnerId = (e: Expense): string =>
    !e.addedBy ? "" : typeof e.addedBy === "string" ? e.addedBy : e.addedBy._id;

export const expenseOwnerName = (e: Expense): string =>
    e.addedBy && typeof e.addedBy === "object" ? e.addedBy.name : "";
