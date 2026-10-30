import { apiClient, ApiEnvelope } from '@/lib/apiClient'
import { buildQuery } from '@/lib/utils'

export type HistoryType =
    | 'joined'
    | 'probation_completed'
    | 'promotion'
    | 'demotion'
    | 'position_change'
    | 'salary_increase'
    | 'salary_decrease'
    | 'transfer'
    | 'rejoined'
    | 'resignation'
    | 'termination'
    | 'other'

export interface HistoryTypeOption {
    value: HistoryType
    label: string
}

// Same list and labels as the backend (GET /employee-history/types). Used as a fallback
// and to label entries without waiting for the request.
export const HISTORY_TYPE_OPTIONS: HistoryTypeOption[] = [
    { value: 'joined', label: 'Joined the company' },
    { value: 'probation_completed', label: 'Probation completed' },
    { value: 'promotion', label: 'Promotion' },
    { value: 'demotion', label: 'Demotion' },
    { value: 'position_change', label: 'Position changed' },
    { value: 'salary_increase', label: 'Salary increase' },
    { value: 'salary_decrease', label: 'Salary decrease' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'rejoined', label: 'Rejoined the company' },
    { value: 'resignation', label: 'Resignation' },
    { value: 'termination', label: 'Termination' },
    { value: 'other', label: 'Other' },
]

export const historyTypeLabel = (type: string) =>
    HISTORY_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type

export interface HistoryEntry {
    _id: string
    employeeId: string
    type: HistoryType
    title: string
    description?: string
    effectiveDate: string

    fromPosition?: string
    toPosition?: string

    fromSalary?: number
    toSalary?: number
    currency?: string

    addedBy?: { _id: string; name: string } | string
    updatedBy?: string

    createdAt: string
    updatedAt: string
}

export interface TimelineEmployee {
    id: string
    name: string
    email: string
    position: string
    status?: 'active' | 'inactive'
    salary?: { amount?: number; currency?: string; effectiveFrom?: string }
    companyId?: string
    joinedAt?: string
}

export interface TimelineSummary {
    totalEvents: number
    promotions: number
    salaryChanges: number
    firstEventDate: string | null
    lastEventDate: string | null
}

// The timeline endpoints return employee + summary next to `data` (not inside it).
export interface TimelineResponse {
    success: boolean
    employee: TimelineEmployee
    summary: TimelineSummary
    data: HistoryEntry[]
}

export type HistoryOrder = 'asc' | 'desc'

export interface HistoryPayload {
    type?: HistoryType
    title?: string
    description?: string
    effectiveDate?: string
    fromPosition?: string
    toPosition?: string
    fromSalary?: number
    toSalary?: number
    currency?: string
    // create only: also sets the employee's current position / salary from toPosition / toSalary
    applyToProfile?: boolean
}

export const fetchHistoryTypes = (token: string) =>
    apiClient<ApiEnvelope<HistoryTypeOption[]>>('/employee-history/types', { token })

// Logged-in user's own timeline
export const fetchMyHistory = (token: string, order: HistoryOrder = 'desc') =>
    apiClient<TimelineResponse>(`/employee-history/me${buildQuery({ order })}`, { token })

// Admin: anyone. Employee: only themselves.
export const fetchEmployeeHistory = (token: string, employeeId: string, order: HistoryOrder = 'desc') =>
    apiClient<TimelineResponse>(`/employee-history/employee/${employeeId}${buildQuery({ order })}`, { token })

export const createHistoryEntry = (token: string, employeeId: string, payload: HistoryPayload) =>
    apiClient<ApiEnvelope<HistoryEntry>>(`/employee-history/employee/${employeeId}`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    })

export const updateHistoryEntry = (token: string, id: string, payload: HistoryPayload) =>
    apiClient<ApiEnvelope<HistoryEntry>>(`/employee-history/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    })

export const deleteHistoryEntry = (token: string, id: string) =>
    apiClient<ApiEnvelope<null>>(`/employee-history/${id}`, {
        method: 'DELETE',
        token,
    })
