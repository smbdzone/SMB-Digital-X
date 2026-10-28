import { apiClient, ApiEnvelope } from '@/lib/apiClient';

export interface Company {
    _id: string;
    name: string;
    code: string;
    legalName?: string;
    logo: string;       // stored value: absolute URL or a path like /images/x.png
    logoUrl: string;    // resolved by the backend, safe to use in <img src>
    brandColor: string;
    address?: string;
    phone?: string;
    website?: string;
    currency: string;
    email: {
        fromName?: string;
        fromEmail?: string;
        replyTo?: string;
        footerNote?: string;
    };
    signatory: {
        name?: string;
        title?: string;
        signature?: string;
    };
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CompanyPayload {
    name?: string;
    code?: string; // only accepted on create
    legalName?: string;
    logo?: string;
    brandColor?: string;
    address?: string;
    phone?: string;
    website?: string;
    currency?: string;
    isActive?: boolean;
    email?: { fromName?: string; fromEmail?: string; replyTo?: string; footerNote?: string };
    signatory?: { name?: string; title?: string; signature?: string };
}

// `all` (admin only) also returns inactive companies.
export const getCompanies = (token: string, all = false) =>
    apiClient<ApiEnvelope<Company[]>>(`/companies${all ? '?all=true' : ''}`, { token });

export const createCompany = (token: string, payload: FormData | any) =>
    apiClient<ApiEnvelope<Company>>('/companies', {
        method: 'POST',
        token,
        body: payload,
    });

export const updateCompany = (token: string, id: string, payload: FormData | any) =>
    apiClient<ApiEnvelope<Company>>(`/companies/${id}`, {
        method: 'PATCH',
        token,
        body: payload,
    });

export const deleteCompany = (token: string, id: string) =>
    apiClient(`/companies/${id}`, {
        method: 'DELETE',
        token
    })