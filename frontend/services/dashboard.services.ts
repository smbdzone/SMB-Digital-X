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

export interface DashboardExpenseStats {
    total: number;
    monthly: number;
}

export interface DashboardBudgetStats {
    total: number;
    remaining: number;
}

export interface DashboardData {
    projects: DashboardProjectStats;

    employees: DashboardEmployeeStats;

    expenses: DashboardExpenseStats;

    budget: DashboardBudgetStats;

    recentProjects: any[];

    recentExpenses: any[];

    expenseByProject: any[];
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