import { apiClient, ApiEnvelope } from "@/lib/apiClient";

export interface Task {
    _id: string;
    projectId: {
        _id: string;
        name: string;
        category?: string;
        clientName?: string;
    } | string;

    title: string;
    description?: string;

    assignedTo: {
        _id: string;
        name: string;
        email: string;
    } | string;

    status:
    | "Todo"
    | "In Progress"
    | "Review"
    | "Completed";

    priority:
    | "Low"
    | "Medium"
    | "High"
    | "Urgent";

    progress: number;

    startDate?: string;
    dueDate?: string;
    completedAt?: string;

    notes?: string;

    createdAt?: string;
    updatedAt?: string;
}

export interface CreateTaskPayload {
    projectId: string;
    title: string;
    description?: string;
    assignedTo: string;
    status?: string;
    priority?: string;
    progress?: number;
    startDate?: string;
    dueDate?: string;
    completedAt?: string;
    notes?: string;
}

export const createTask = (
    payload: CreateTaskPayload,
    token: string
) => {
    return apiClient<ApiEnvelope<Task>>(
        "/tasks",
        {
            method: "POST",
            token,
            body: JSON.stringify(payload),
        }
    );
};

export const fetchProjectTasks = (
    projectId: string,
    token: string
) => {
    return apiClient<ApiEnvelope<Task[]>>(
        `/tasks/project/${projectId}`,
        {
            token,
        }
    );
};

export const fetchSingleTask = (
    id: string,
    token: string
) => {
    return apiClient<ApiEnvelope<Task>>(
        `/tasks/${id}`,
        {
            token,
        }
    );
};

export const updateTask = (
    id: string,
    payload: Partial<CreateTaskPayload>,
    token: string
) => {
    return apiClient<ApiEnvelope<Task>>(
        `/tasks/${id}`,
        {
            method: "PUT",
            token,
            body: JSON.stringify(payload),
        }
    );
};

export const deleteTask = (
    id: string,
    token: string
) => {
    return apiClient<ApiEnvelope>(
        `/tasks/${id}`,
        {
            method: "DELETE",
            token,
        }
    );
};

export const fetchEmployeeTasks = (token: string) => {
    return apiClient<ApiEnvelope<Task[]>>(
        "/tasks/employee",
        {
            token
        }
    );
};