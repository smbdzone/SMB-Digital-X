import {
    apiClient,
    ApiEnvelope,
} from "@/lib/apiClient";

export interface DashboardProjectStats {
    total: number;
    active: number;
    completed: number;
    planning: number;
    onHold: number;
}

export interface DashboardEmployeeStats {
    total: number;
    active: number;
}


export interface DashboardData {
    projects: DashboardProjectStats;

    employees: DashboardEmployeeStats;

    // Company-wide finance figures are only in the Owner Console.
    finance: { locked: true };

    recentProjects: any[];

    recentExpenses: any[];
}

export const fetchDashboard = (
    token: string
) => {
    return apiClient<
        ApiEnvelope<DashboardData>
    >("/dashboard", {
        token,
    });
};