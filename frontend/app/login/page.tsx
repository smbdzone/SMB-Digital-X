"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
    FiEye,
    FiEyeOff,
    FiLock,
    FiMail,
    FiAlertCircle,
} from "react-icons/fi";

import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
    const router = useRouter();

    const { loginUser, loading, error, clearError } = useAuth();

    const [showPassword, setShowPassword] = useState(false);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [rememberMe, setRememberMe] = useState(false);

    const [errors, setErrors] = useState<{
        email?: string;
        password?: string;
    }>({});

    const [touched, setTouched] = useState<{
        email: boolean;
        password: boolean;
    }>({
        email: false,
        password: false,
    });

    const validateEmail = (value: string) => {
        const emailValue = value.trim();

        if (!emailValue) {
            return "Email is required";
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
            return "Please enter a valid email address";
        }

        return "";
    };

    const validatePassword = (value: string) => {
        if (!value) {
            return "Password is required";
        }

        if (value.length < 6) {
            return "Password must be at least 6 characters";
        }

        return "";
    };

    const handleEmailChange = (value: string) => {
        setEmail(value);

        if (error) {
            clearError();
        }

        if (touched.email) {
            setErrors((prev) => ({
                ...prev,
                email: validateEmail(value),
            }));
        }
    };

    const handlePasswordChange = (value: string) => {
        setPassword(value);

        if (error) {
            clearError();
        }

        if (touched.password) {
            setErrors((prev) => ({
                ...prev,
                password: validatePassword(value),
            }));
        }
    };

    const handleBlur = (field: "email" | "password") => {
        setTouched((prev) => ({
            ...prev,
            [field]: true,
        }));

        if (field === "email") {
            setErrors((prev) => ({
                ...prev,
                email: validateEmail(email),
            }));
        }

        if (field === "password") {
            setErrors((prev) => ({
                ...prev,
                password: validatePassword(password),
            }));
        }
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const emailError = validateEmail(email);
        const passwordError = validatePassword(password);

        setErrors({
            email: emailError,
            password: passwordError,
        });

        setTouched({
            email: true,
            password: true,
        });

        if (emailError || passwordError) {
            return;
        }

        try {
            await loginUser({
                email: email.trim(),
                password,
            });

            router.replace("/");
        } catch {
            /*
             * AuthProvider already sets the error.
             */
        }
    };

    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#14141e] to-[#1a1a2e] p-4 sm:p-6 lg:p-8">
            <div className="w-full max-w-md">

                {/* Logo */}
                <div className="mb-8 flex items-center justify-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg shadow-blue-500/25">
                        <span className="font-heading text-xl font-bold text-white">
                            F
                        </span>
                    </div>

                    <div>
                        <p className="font-heading text-xl font-bold tracking-tight text-white">
                            Finance
                        </p>

                        <p className="text-[11px] uppercase tracking-wider text-white/50">
                            Management System
                        </p>
                    </div>
                </div>

                {/* Card */}
                <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">

                    {/* Decorative glow */}
                    <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

                    <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />

                    {/* Heading */}
                    <div className="relative mb-7 text-center">
                        <h2 className="font-heading text-2xl font-semibold tracking-tight text-white! sm:text-3xl">
                            Welcome back
                        </h2>

                        <p className="mt-1.5 text-sm text-white/60">
                            Sign in to access your management dashboard.
                        </p>
                    </div>

                    {/* API Error */}
                    {error && (
                        <div
                            role="alert"
                            className="relative mb-5 flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                        >
                            <FiAlertCircle
                                size={18}
                                className="shrink-0"
                            />

                            <span>{error}</span>
                        </div>
                    )}

                    {/* Form */}
                    <form
                        onSubmit={handleSubmit}
                        className="relative space-y-5"
                        noValidate
                    >
                        {/* Email */}
                        <div>
                            <label
                                htmlFor="email"
                                className="mb-1.5 block text-sm font-medium text-white/80"
                            >
                                Email address
                            </label>

                            <div className="relative">
                                <FiMail
                                    size={18}
                                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"
                                />

                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="admin@example.com"
                                    value={email}
                                    onChange={(e) =>
                                        handleEmailChange(e.target.value)
                                    }
                                    onBlur={() =>
                                        handleBlur("email")
                                    }
                                    disabled={loading}
                                    aria-invalid={
                                        !!(
                                            errors.email &&
                                            touched.email
                                        )
                                    }
                                    aria-describedby={
                                        errors.email && touched.email
                                            ? "email-error"
                                            : undefined
                                    }
                                    className={`
                                        h-12 w-full rounded-xl border
                                        bg-white/5 pl-11 pr-4
                                        text-sm text-white
                                        outline-none
                                        placeholder:text-white/30
                                        transition-all duration-200
                                        focus:ring-2
                                        disabled:cursor-not-allowed
                                        disabled:opacity-60
                                        hover:border-white/20
                                        ${errors.email &&
                                            touched.email
                                            ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                                            : "border-white/10 focus:border-blue-400 focus:ring-blue-400/20"
                                        }
                                    `}
                                />
                            </div>

                            {errors.email && touched.email && (
                                <p
                                    id="email-error"
                                    className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400"
                                >
                                    <FiAlertCircle size={14} />
                                    {errors.email}
                                </p>
                            )}
                        </div>

                        {/* Password */}
                        <div>
                            <div className="mb-1.5 flex items-center justify-between">
                                <label
                                    htmlFor="password"
                                    className="text-sm font-medium text-white/80"
                                >
                                    Password
                                </label>

                                <Link
                                    href="/forgot-password"
                                    className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
                                >
                                    Forgot password?
                                </Link>
                            </div>

                            <div className="relative">
                                <FiLock
                                    size={18}
                                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"
                                />

                                <input
                                    id="password"
                                    name="password"
                                    type={
                                        showPassword
                                            ? "text"
                                            : "password"
                                    }
                                    autoComplete="current-password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) =>
                                        handlePasswordChange(
                                            e.target.value
                                        )
                                    }
                                    onBlur={() =>
                                        handleBlur("password")
                                    }
                                    disabled={loading}
                                    aria-invalid={
                                        !!(
                                            errors.password &&
                                            touched.password
                                        )
                                    }
                                    aria-describedby={
                                        errors.password &&
                                            touched.password
                                            ? "password-error"
                                            : undefined
                                    }
                                    className={`
                                        h-12 w-full rounded-xl border
                                        bg-white/5 pl-11 pr-12
                                        text-sm text-white
                                        outline-none
                                        placeholder:text-white/30
                                        transition-all duration-200
                                        focus:ring-2
                                        disabled:cursor-not-allowed
                                        disabled:opacity-60
                                        hover:border-white/20
                                        ${errors.password &&
                                            touched.password
                                            ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                                            : "border-white/10 focus:border-blue-400 focus:ring-blue-400/20"
                                        }
                                    `}
                                />

                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassword(
                                            (prev) => !prev
                                        )
                                    }
                                    disabled={loading}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label={
                                        showPassword
                                            ? "Hide password"
                                            : "Show password"
                                    }
                                >
                                    {showPassword ? (
                                        <FiEyeOff size={18} />
                                    ) : (
                                        <FiEye size={18} />
                                    )}
                                </button>
                            </div>

                            {errors.password &&
                                touched.password && (
                                    <p
                                        id="password-error"
                                        className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400"
                                    >
                                        <FiAlertCircle size={14} />
                                        {errors.password}
                                    </p>
                                )}
                        </div>

                        {/* Remember */}
                        <div className="flex items-center justify-between gap-3">
                            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/60 transition-colors hover:text-white/80">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) =>
                                        setRememberMe(
                                            e.target.checked
                                        )
                                    }
                                    disabled={loading}
                                    className="h-4 w-4 rounded border-white/20 bg-white/5 accent-blue-500 focus:ring-2 focus:ring-blue-400/20"
                                />

                                Remember me
                            </label>

                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="
                                group relative h-12 w-full
                                overflow-hidden rounded-xl
                                bg-gradient-to-r
                                from-blue-500 to-blue-600
                                px-4 text-sm font-semibold text-white
                                shadow-lg shadow-blue-500/25
                                transition-all duration-300
                                hover:scale-[1.02]
                                hover:shadow-blue-500/40
                                active:scale-[0.98]
                                disabled:cursor-not-allowed
                                disabled:opacity-70
                                disabled:hover:scale-100
                            "
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                {loading ? (
                                    <>
                                        <svg
                                            className="h-5 w-5 animate-spin"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            aria-hidden="true"
                                        >
                                            <circle
                                                className="opacity-25"
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                strokeWidth="4"
                                            />

                                            <path
                                                className="opacity-75"
                                                fill="currentColor"
                                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                            />
                                        </svg>

                                        Signing in...
                                    </>
                                ) : (
                                    "Sign in"
                                )}
                            </span>

                            {!loading && (
                                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}