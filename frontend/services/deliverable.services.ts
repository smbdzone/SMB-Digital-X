import { apiClient, ApiEnvelope } from "@/lib/apiClient";
import { buildQuery } from "@/lib/utils";

// ========================================
// Types (mirror backend/src/model/deliverable.model.ts)
// ========================================

export type DeliverablePriority = "Low" | "Medium" | "High" | "Urgent";
export type DeliverableSource = "self" | "task" | "approver" | "carried_over";
export type ApprovalStatus = "draft" | "pending" | "approved";
export type DeliverableOutcome = "completed" | "in_progress" | "not_started";
export type PlanState = "empty" | "draft" | "pending" | "approved";

export const PRIORITIES: DeliverablePriority[] = ["Low", "Medium", "High", "Urgent"];

// "in_progress" is shown as "Half completed" everywhere: it counts as half in the EOD progress.
export const OUTCOME_LABELS: Record<DeliverableOutcome, string> = {
    completed: "Completed",
    in_progress: "Half completed",
    not_started: "Not started",
};

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
    draft: "Draft",
    pending: "Waiting for approval",
    approved: "Approved",
};

export const PLAN_STATE_LABELS: Record<PlanState, string> = {
    empty: "No plan",
    draft: "Not submitted",
    pending: "Waiting for approval",
    approved: "Approved",
};

export const SOURCE_LABELS: Record<DeliverableSource, string> = {
    self: "",
    task: "Assigned task",
    approver: "Added by approver",
    carried_over: "Carried over",
};

interface NamedRef { _id: string; name: string }

export interface Deliverable {
    _id: string;
    employeeId: string;
    dateKey: string;
    title: string;
    description?: string;
    projectId?: NamedRef | null;
    taskId?: { _id: string; title: string; status?: string; progress?: number } | null;
    priority: DeliverablePriority;
    estimatedHours?: number | null;
    source: DeliverableSource;
    carriedFromId?: string | null;
    carriedTo?: string | null;
    order: number;
    approvalStatus: ApprovalStatus;
    approvedBy?: NamedRef | null;
    approvedAt?: string | null;
    editedByApprover?: boolean;
    editedBy?: NamedRef | null;
    original?: { title?: string; description?: string; priority?: DeliverablePriority; estimatedHours?: number | null } | null;
    outcome?: DeliverableOutcome | null;
    outcomeNote?: string;
    actualHours?: number | null;
    taskProgress?: number | null;
    reportedAt?: string | null;
}

export interface MyDay {
    date: string;
    today: string;
    state: PlanState;
    items: Deliverable[];
}

export interface DeliverableInput {
    date?: string;
    employeeId?: string;
    title?: string;
    description?: string;
    priority?: DeliverablePriority;
    estimatedHours?: number | null;
    projectId?: string | null;
}

export interface PlanEmployee {
    _id: string;
    name: string;
    email?: string;
    position?: string;
    companyId?: string;
}

export interface QueuePlan {
    employee: PlanEmployee;
    date: string;
    pending: number;
    items: Deliverable[];
}

export interface TeamDayRow {
    employee: PlanEmployee;
    state: PlanState;
    items: Deliverable[];
    eod: {
        _id: string;
        summary?: string;
        blockers?: string;
        overallProgress: number;
        deliverableStats?: { planned: number; completed: number; inProgress: number; notStarted: number };
        createdAt: string;
    } | null;
}

export interface DeliverableStats {
    planned: number;
    approved: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    completionRate: number | null;
    weightedRate: number | null;
    carriedOver: number;
    estimatedHours: number;
    actualHours: number;
    daysWithPlan: number;
    daysWithEod: number;
}

export interface DaySummary {
    date: string;
    activeEmployees: number;
    plansSubmitted: number;
    plansPendingApproval: number;
    eodsSubmitted: number;
}

export interface OutcomeInput {
    deliverableId: string;
    outcome: DeliverableOutcome;
    outcomeNote?: string;
    actualHours?: number | null;
    taskProgress?: number | null;
}

// ========================================
// Employee
// ========================================

export const fetchDeliverableAccess = (token: string) =>
    apiClient<ApiEnvelope<{ canApprove: boolean; admin: boolean }>>("/deliverables/access", { token });

export const fetchMyDay = (token: string, date?: string) =>
    apiClient<ApiEnvelope<MyDay>>(`/deliverables/my${buildQuery({ date })}`, { token });

export const fetchLinkableProjects = (token: string) =>
    apiClient<ApiEnvelope<NamedRef[]>>("/deliverables/projects", { token });

export const createDeliverable = (token: string, payload: DeliverableInput) =>
    apiClient<ApiEnvelope<Deliverable>>("/deliverables", { method: "POST", token, body: JSON.stringify(payload) });

export const updateDeliverable = (token: string, id: string, payload: DeliverableInput) =>
    apiClient<ApiEnvelope<Deliverable>>(`/deliverables/${id}`, { method: "PATCH", token, body: JSON.stringify(payload) });

export const deleteDeliverable = (token: string, id: string) =>
    apiClient<ApiEnvelope<null>>(`/deliverables/${id}`, { method: "DELETE", token });

export const reorderMyDay = (token: string, date: string, ids: string[]) =>
    apiClient<ApiEnvelope<Deliverable[]>>("/deliverables/my/order", { method: "PUT", token, body: JSON.stringify({ date, ids }) });

export const addTasksToDay = (token: string, date: string, taskIds: string[]) =>
    apiClient<ApiEnvelope<{ added: number; items: Deliverable[] }>>("/deliverables/from-tasks", {
        method: "POST", token, body: JSON.stringify({ date, taskIds }),
    });

export const carryOverToDay = (token: string, date: string) =>
    apiClient<ApiEnvelope<{ added: number; from: string | null; items: Deliverable[] }>>("/deliverables/carry-over", {
        method: "POST", token, body: JSON.stringify({ date }),
    });

export const submitMyDay = (token: string, date: string) =>
    apiClient<ApiEnvelope<{ submitted: number; items: Deliverable[] }>>("/deliverables/submit", {
        method: "POST", token, body: JSON.stringify({ date }),
    });

export const fetchMyStats = (token: string, params: { from?: string; to?: string } = {}) =>
    apiClient<ApiEnvelope<{ from: string; to: string; stats: DeliverableStats }>>(`/deliverables/stats/me${buildQuery(params)}`, { token });

// ========================================
// Approvers (admin + users with canApproveDeliverables)
// ========================================

export const fetchEmployeeDay = (token: string, employeeId: string, date: string) =>
    apiClient<ApiEnvelope<{ date: string; state: PlanState; items: Deliverable[] }>>(
        `/deliverables/day${buildQuery({ employeeId, date })}`, { token });

export const fetchApprovalQueue = (token: string, params: { date?: string; from?: string; to?: string; employeeId?: string } = {}) =>
    apiClient<ApiEnvelope<QueuePlan[]>>(`/deliverables/approvals${buildQuery(params)}`, { token });

export const approvePlans = (token: string, plans: { employeeId: string; date: string }[]) =>
    apiClient<ApiEnvelope<{ employeeId: string; date: string; approved: number; skipped?: string }[]>>("/deliverables/approve", {
        method: "POST", token, body: JSON.stringify({ plans }),
    });

export const fetchTeamDay = (token: string, date: string) =>
    apiClient<ApiEnvelope<{ date: string; employees: TeamDayRow[] }>>(`/deliverables/team${buildQuery({ date })}`, { token });

export const fetchTeamStats = (token: string, params: { from?: string; to?: string; employeeId?: string } = {}) =>
    apiClient<ApiEnvelope<{ from: string; to: string; employees: { employee: PlanEmployee; stats: DeliverableStats }[] }>>(
        `/deliverables/stats${buildQuery(params)}`, { token });

export const fetchDaySummary = (token: string, date?: string) =>
    apiClient<ApiEnvelope<DaySummary>>(`/deliverables/summary${buildQuery({ date })}`, { token });
