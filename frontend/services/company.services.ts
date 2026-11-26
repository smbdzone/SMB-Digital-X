import { apiClient, ApiEnvelope } from '@/lib/apiClient';

// Same list as backend/src/utils/letterheadDesigns.ts. A company's design is fixed; only the letter text changes.
export const LETTERHEAD_DESIGNS = [
    { value: 'axis-aura', label: 'Axis Aura' },
    { value: 'smb-proptech', label: 'SMB Axis Proptech' },
    { value: 'smb-digitalzone', label: 'SMB DigitalZone' },
    { value: 'plain', label: 'Plain' },
] as const;
export type LetterheadDesign = typeof LETTERHEAD_DESIGNS[number]['value'];
export const letterheadLabel = (design?: string | null) =>
    LETTERHEAD_DESIGNS.find(d => d.value === design)?.label ?? 'Plain';

export interface Company {
    _id: string;
    name: string;
    code: string;
    /** The stored choice; null/undefined = the design with the same code, else Plain. */
    letterhead?: LetterheadDesign | null;
    /** The design actually used for this company's letters (worked out by the backend). */
    letterheadDesign?: LetterheadDesign;
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