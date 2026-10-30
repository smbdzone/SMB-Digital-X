import { apiClient, ApiEnvelope } from '@/lib/apiClient'

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'delayed'
export type MilestonePaymentStatus = 'unpaid' | 'invoiced' | 'paid'
export type PaymentMode = 'percentage' | 'amount'

export const MILESTONE_STATUS_OPTIONS: { value: MilestoneStatus; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'delayed', label: 'Delayed' },
]

export const MILESTONE_PAYMENT_OPTIONS: { value: MilestonePaymentStatus; label: string }[] = [
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'invoiced', label: 'Invoiced' },
    { value: 'paid', label: 'Paid' },
]

export interface Deliverable {
    _id: string
    title: string
    description?: string
    isDone: boolean
    doneAt?: string
}

export interface Milestone {
    _id: string
    projectId: string
    title: string
    description?: string
    order: number

    startDate?: string
    deadline?: string

    paymentMode: PaymentMode
    paymentPercentage: number // share of the project budget (0-100), calculated from the current budget
    paymentAmount: number     // money value of that share
    currency: string

    deliverables: Deliverable[]

    status: MilestoneStatus
    completedAt?: string

    paymentStatus: MilestonePaymentStatus
    invoicedAt?: string
    paidAt?: string

    notes?: string

    // added by the backend
    isOverdue: boolean
    deliverablesTotal: number
    deliverablesDone: number

    createdAt: string
    updatedAt: string
}

export interface MilestoneSummary {
    total: number
    pending: number
    inProgress: number
    completed: number
    delayed: number
    overdue: number
    progressPercent: number
    budget: number
    allocatedPercent: number
    allocatedAmount: number
    unallocatedPercent: number
    unallocatedAmount: number
    paidAmount: number
    invoicedAmount: number
    unpaidAmount: number
}

export interface MilestoneListResponse {
    success: boolean
    project: { id: string; name: string; status: string; budget: number }
    summary: MilestoneSummary
    data: Milestone[]
}

export interface DeliverablePayload {
    _id?: string // send it to keep an existing item (and its done state)
    title: string
    description?: string
    isDone?: boolean
}

// Send EITHER paymentPercentage OR paymentAmount (if both are sent the backend uses the percentage).
export interface MilestonePayload {
    title?: string
    description?: string
    startDate?: string | null // null or '' clears the date
    deadline?: string | null
    paymentPercentage?: number
    paymentAmount?: number
    currency?: string
    deliverables?: DeliverablePayload[] // on update this REPLACES the list
    status?: MilestoneStatus
    paymentStatus?: MilestonePaymentStatus
    paidAt?: string
    notes?: string
}

export const fetchProjectMilestones = (token: string, projectId: string) =>
    apiClient<MilestoneListResponse>(`/milestones/project/${projectId}`, { token })

export const createMilestone = (token: string, projectId: string, payload: MilestonePayload) =>
    apiClient<ApiEnvelope<Milestone>>(`/milestones/project/${projectId}`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    })

export const updateMilestone = (token: string, id: string, payload: MilestonePayload) =>
    apiClient<ApiEnvelope<Milestone>>(`/milestones/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    })

export const updateMilestoneStatus = (token: string, id: string, status: MilestoneStatus) =>
    apiClient<ApiEnvelope<Milestone>>(`/milestones/${id}/status`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status }),
    })

export const updateMilestonePayment = (token: string, id: string, paymentStatus: MilestonePaymentStatus, paidAt?: string) =>
    apiClient<ApiEnvelope<Milestone>>(`/milestones/${id}/payment`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ paymentStatus, ...(paidAt ? { paidAt } : {}) }),
    })

export const toggleDeliverable = (token: string, milestoneId: string, deliverableId: string, isDone?: boolean) =>
    apiClient<ApiEnvelope<Milestone>>(`/milestones/${milestoneId}/deliverables/${deliverableId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(isDone === undefined ? {} : { isDone }),
    })

// Full list of milestone ids in the new order
export const reorderMilestones = (token: string, projectId: string, order: string[]) =>
    apiClient<ApiEnvelope<Milestone[]>>(`/milestones/project/${projectId}/reorder`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ order }),
    })

export const deleteMilestone = (token: string, id: string) =>
    apiClient<ApiEnvelope<null>>(`/milestones/${id}`, {
        method: 'DELETE',
        token,
    })
