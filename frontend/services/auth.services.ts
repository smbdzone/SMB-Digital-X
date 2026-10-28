import { apiClient, ApiEnvelope } from "@/lib/apiClient";

export interface LoginPayload {
    email: string;
    password: string;
}

export interface BankDetails {
    method?: string;
    bankName?: string;
    holderName?: string;
    accountNumber?: string;
    iban?: string;
}

export interface RegisterPayload {
    name: string;
    email: string;
    password: string;
    salaryAmount?: number;
    salaryCurrency?: string;
    companyId?: string;
    position?: string;
    bankDetails?: BankDetails;
}

// Admin can change everything. Employees can only update their own profile fields.
export interface UpdateEmployeePayload {
    name?: string;
    email?: string;
    password?: string;
    position?: string;
    status?: "active" | "inactive";
    salaryAmount?: number;
    salaryCurrency?: string;
    companyId?: string;
    bankDetails?: BankDetails;
}

export interface User {
    _id: string;
    id?: string
    name: string;
    email: string;
    role: string;
    position?: string
    status?: "active" | "inactive";
    companyId?: string;
    salary?: { amount?: number; currency?: string; effectiveFrom?: string };
    [key: string]: unknown;
}

export interface LoginResponse {
    token: string;
    user: User;
}

export const login = (
    payload: LoginPayload
): Promise<ApiEnvelope<LoginResponse>> => {
    return apiClient<ApiEnvelope<LoginResponse>>("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
    });
};

export const fetchProfile = (
    token: string
): Promise<ApiEnvelope<User>> => {
    return apiClient<ApiEnvelope<User>>("/auth/user", {
        token,
    });
};

// Admin only now (it used to be public), so a token is required.
export const registerEmployee = (token: string, payload: RegisterPayload) => {
    return apiClient<ApiEnvelope>('/auth/register', {
        method: "POST",
        token,
        body: JSON.stringify(payload)
    })
}

export const updateEmployee = (token: string, id: string, payload: UpdateEmployeePayload) => {
    return apiClient<ApiEnvelope>(`/auth/update/${id}`, {
        method: "PATCH",
        token: token,
        body: JSON.stringify(payload)
    })
}

// Fetch all employees (admin only)
export const fetchAllEmployees = (token: string): Promise<ApiEnvelope<User[]>> => {
    return apiClient<ApiEnvelope<User[]>>('/auth/all-user', {
        token: token
    })
}

// Delete an employee
export const deleteEmployee = (id: string, token: string): Promise<ApiEnvelope<null>> => {
    return apiClient<ApiEnvelope<null>>(`/auth/delete-user/${id}`, {
        method: 'DELETE',
        token: token
    })
}

/* ---------------------------------------------------------------- */
/* Forgot password (public: no token needed)                         */
/* ---------------------------------------------------------------- */

// Always answers with the same message, whether or not the email has an account.
export const forgotPassword = (email: string): Promise<ApiEnvelope> => {
    return apiClient<ApiEnvelope>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
    })
}

// Optional check of the 6-digit code before showing the "new password" form. Does not use the code up.
export const verifyResetCode = (email: string, code: string): Promise<ApiEnvelope> => {
    return apiClient<ApiEnvelope>('/auth/verify-reset-code', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
    })
}

export interface ResetPasswordPayload {
    email: string;
    code: string;
    newPassword: string;
}

export const resetPassword = (payload: ResetPasswordPayload): Promise<ApiEnvelope> => {
    return apiClient<ApiEnvelope>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(payload),
    })
}
