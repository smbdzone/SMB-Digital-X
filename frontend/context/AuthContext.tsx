"use client";

import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import Cookies from "js-cookie";

import { APP_STORAGE_KEYS } from "@/lib/config";
import { disablePush } from "@/lib/push";
import {
    login,
    type LoginPayload,
    type User,
} from "@/services/auth.services";

const COOKIE_OPTIONS = {
    path: "/",
    sameSite: "lax" as const,
};

interface AuthContextValue {
    user: User | null;
    token: string | null;
    role: string | null;
    loading: boolean;
    error: string | null;
    isAuthenticated: boolean;

    loginUser: (payload: LoginPayload) => Promise<User>;
    logout: () => void;
    clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({
    children,
}: {
    children: ReactNode;
}) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    //Restore existing session from cookies.
    useEffect(() => {
        try {
            const storedToken =
                Cookies.get(APP_STORAGE_KEYS.token) ?? null;

            const storedRoleRaw =
                Cookies.get(APP_STORAGE_KEYS.role) ?? null;

            const storedUserRaw =
                Cookies.get(APP_STORAGE_KEYS.user) ?? null;

            if (storedToken) {
                setToken(storedToken);
            }

            if (storedRoleRaw) {
                try {
                    const parsedRole = JSON.parse(storedRoleRaw);

                    if (typeof parsedRole === "string") {
                        setRole(parsedRole);
                    }
                } catch {
                    // Backward compatibility if role was stored as plain text.
                    setRole(storedRoleRaw);
                }
            }

            if (storedUserRaw) {
                try {
                    const parsedUser = JSON.parse(storedUserRaw);

                    if (parsedUser && typeof parsedUser === "object") {
                        setUser(parsedUser as User);
                    }
                } catch {
                    Cookies.remove(APP_STORAGE_KEYS.user, {
                        path: "/",
                    });
                }
            }
        } catch (error) {
            console.error("Failed to restore auth session:", error);
        } finally {
            setLoading(false);
        }
    }, []);


    const persistSession = useCallback(
        (nextToken: string, nextUser: User) => {
            const nextRole = nextUser.role;

            setToken(nextToken);
            setUser(nextUser);
            setRole(nextRole);

            Cookies.set(
                APP_STORAGE_KEYS.token,
                nextToken,
                COOKIE_OPTIONS
            );

            Cookies.set(
                APP_STORAGE_KEYS.role,
                JSON.stringify(nextRole),
                COOKIE_OPTIONS
            );

            Cookies.set(
                APP_STORAGE_KEYS.user,
                JSON.stringify(nextUser),
                COOKIE_OPTIONS
            );
        },
        []
    );


    const clearSession = useCallback(() => {
        setToken(null);
        setUser(null);
        setRole(null);
        setError(null);

        Cookies.remove(APP_STORAGE_KEYS.token, {
            path: "/",
        });

        Cookies.remove(APP_STORAGE_KEYS.role, {
            path: "/",
        });

        Cookies.remove(APP_STORAGE_KEYS.user, {
            path: "/",
        });
    }, []);

    //Login 
    const loginUser = useCallback(
        async (payload: LoginPayload): Promise<User> => {
            setLoading(true);
            setError(null);

            try {
                const response = await login(payload);

                const loginData = response.data;

                if (!loginData) {
                    throw new Error(
                        response.message || "Invalid login response"
                    );
                }

                const { token: nextToken, user: nextUser } = loginData;

                if (!nextToken) {
                    throw new Error("Authentication token was not returned");
                }

                if (!nextUser) {
                    throw new Error("User information was not returned");
                }

                if (!nextUser.role) {
                    throw new Error("User role was not returned");
                }

                persistSession(nextToken, nextUser);

                return nextUser;
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Login failed";

                setError(message);

                throw error;
            } finally {
                setLoading(false);
            }
        },
        [persistSession]
    );

    // Logout.

    const logout = useCallback(() => {
        // Stop browser push for this user on this device (best effort), before the token is cleared.
        if (token) void disablePush(token);
        clearSession();
    }, [clearSession, token]);

    /*
     * Clear current error.
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const isAuthenticated = Boolean(token && user);

    /*
     * Prevent unnecessary context re-renders.
     */
    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            token,
            role,
            loading,
            error,
            isAuthenticated,

            loginUser,
            logout,
            clearError,
        }),
        [
            user,
            token,
            role,
            loading,
            error,
            isAuthenticated,
            loginUser,
            logout,
            clearError,
        ]
    );

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

/*
 * Auth hook.
 */
export const useAuth = (): AuthContextValue => {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error(
            "useAuth must be used inside an AuthProvider"
        );
    }

    return context;
};