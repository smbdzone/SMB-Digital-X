const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export interface ApiEnvelope<T = unknown> {
    success?: boolean;
    message?: string;
    data?: T;
    [key: string]: any;
}

interface ApiRequestOptions extends RequestInit {
    token?: string | null;
    responseType?: "json" | "blob";
}

export class ApiError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

export async function apiClient<T = ApiEnvelope>(
    path: string,
    {
        token,
        headers,
        body,
        responseType = "json",
        ...rest
    }: ApiRequestOptions = {}
): Promise<T> {
    const url = path.startsWith("http")
        ? path
        : `${API_BASE_URL}${path}`;

    const finalHeaders = new Headers(headers);

    const isFormData =
        typeof FormData !== "undefined" &&
        body instanceof FormData;

    if (!isFormData && !finalHeaders.has("Content-Type")) {
        finalHeaders.set("Content-Type", "application/json");
    }

    if (token) {
        finalHeaders.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
        ...rest,
        headers: finalHeaders,
        body: isFormData ? (body as BodyInit) : body,
        cache: rest.cache ?? "no-store",
        credentials: "include",
    });

    // Handle Blob responses
    if (responseType === "blob") {
        if (!response.ok) {
            let message = "Request failed";

            try {
                const errorText = await response.text();
                const parsed = errorText ? JSON.parse(errorText) : {};

                message = parsed?.message || message;
            } catch {
                // Response wasn't JSON
            }

            throw new ApiError(message, response.status);
        }

        return (await response.blob()) as T;
    }

    // Handle normal JSON responses
    const raw = await response.text();

    let parsed: any = {};

    try {
        parsed = raw ? JSON.parse(raw) : {};
    } catch {
        throw new ApiError(
            "Invalid JSON response",
            response.status
        );
    }

    if (!response.ok || parsed?.success === false) {
        throw new ApiError(
            parsed.message || "Request failed",
            response.status
        );
    }

    return parsed as T;
}