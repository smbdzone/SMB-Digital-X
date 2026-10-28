import { apiClient, ApiEnvelope } from "@/lib/apiClient";

export interface ProjectEmployee {
    _id: string;
    name: string;
    email: string;
    role?: string;
}

export type ProjectStatus =
    | "Planning"
    | "Active"
    | "Completed"
    | "On Hold";

export interface Project {
    _id: string;
    name: string;
    clientName: string;
    description?: string;
    startDate: string;
    deadline?: string;
    budget: number;
    status: ProjectStatus;
    employees?: ProjectEmployee[];
    category:string
    createdAt: string;
    updatedAt: string;
}

export interface CreateProjectPayload {
    name: string;
    clientName: string;
    description?: string;
    startDate: string;
    deadline?: string;
    budget: number;
    status?: ProjectStatus;
    employees?: string[];
}

export const createProject = (
    token: string,
    payload: CreateProjectPayload
) => {
    return apiClient<ApiEnvelope<Project>>("/projects", {
        method: "POST",
        token,
        body: JSON.stringify(payload),
    });
};

export const fetchProjects = (token: string) => {
    return apiClient<ApiEnvelope<Project[]>>("/projects", {
        token,
    });
};

export const fetchProject = (
    token: string,
    id: string
) => {
    return apiClient<ApiEnvelope<Project>>(`/projects/${id}`, {
        token,
    });
};

export const updateProject = (
    token: string,
    id: string,
    payload: Partial<CreateProjectPayload>
) => {
    return apiClient<ApiEnvelope<Project>>(`/projects/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(payload),
    });
};

export const deleteProject = (
    token: string,
    id: string
) => {
    return apiClient<ApiEnvelope<null>>(`/projects/${id}`, {
        method: "DELETE",
        token,
    });
};