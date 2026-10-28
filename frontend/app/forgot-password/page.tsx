"use client";

import {
    ClipboardEvent,
    FormEvent,
    KeyboardEvent,
    useEffect,
    useRef,
    useState,
} from "react";
import Link from "next/link";
import {
    FiAlertCircle,
    FiArrowLeft,
    FiCheck,
    FiCheckCircle,
    FiEye,
    FiEyeOff,
    FiLock,
    FiMail,
} from "react-icons/fi";

import {
    forgotPassword,
    resetPassword,
    verifyResetCode,
} from "@/services/auth.services";
import { errorMessage } from "@/lib/utils";

type Step = "email" | "code" | "password" | "done";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60; // same as the backend cooldown between two codes
const MIN_PASSWORD = 8; // same as the backend
const MAX_PASSWORD = 128;

const STEP_INDEX: Record<Step, number> = {
    email: 0,
    code: 1,
    password: 2,
    done: 3,
};

const emptyDigits = () => Array<string>(CODE_LENGTH).fill("");

const validateEmail = (value: string) => {
    const emailValue = value.trim();

    if (!emailValue) return "Email is required";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        return "Please enter a valid email address";
    }

    return "";
};

const inputClass = (hasError: boolean) => `
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
    ${hasError
        ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
        : "border-white/10 focus:border-blue-400 focus:ring-blue-400/20"
    }
`;

const primaryButtonClass = `
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
`;

const Spinner = () => (
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
);

export default function ForgotPasswordPage() {
    const [step, setStep] = useState<Step>("email");

    const [email, setEmail] = useState("");
    const [emailError, setEmailError] = useState("");

    const [digits, setDigits] = useState<string[]>(emptyDigits);
    const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [passwordError, setPasswordError] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [cooldown, setCooldown] = useState(0);

    // Counts down the "Resend code" timer.
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    // Puts the cursor in the first box when the code step opens.
    useEffect(() => {
        if (step === "code") codeRefs.current[0]?.focus();
    }, [step]);

    const code = digits.join("");

    /* -------------------------------------------------------------- */
    /* Step 1: email                                                   */
    /* -------------------------------------------------------------- */

    const sendCode = async (isResend: boolean) => {
        setLoading(true);
        setError("");
        setInfo("");

        try {
            await forgotPassword(email.trim());

            setDigits(emptyDigits());
            setCooldown(RESEND_SECONDS);
            setStep("code");
            setInfo(
                isResend
                    ? "A new code was sent. Check your inbox and spam folder."
                    : `If an account exists for ${email.trim()}, a 6-digit code is on its way. It is valid for 10 minutes.`
            );
        } catch (err) {
            setError(
                errorMessage(err, "Could not send the code. Please try again.")
            );
        } finally {
            setLoading(false);
        }
    };

    const handleEmailSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const problem = validateEmail(email);
        setEmailError(problem);
        if (problem) return;

        sendCode(false);
    };

    /* -------------------------------------------------------------- */
    /* Step 2: code                                                    */
    /* -------------------------------------------------------------- */

    const handleDigitChange = (index: number, value: string) => {
        const digit = value.replace(/\D/g, "").slice(-1);

        setDigits((prev) => {
            const next = [...prev];
            next[index] = digit;
            return next;
        });

        if (error) setError("");
        if (digit && index < CODE_LENGTH - 1) {
            codeRefs.current[index + 1]?.focus();
        }
    };

    const handleDigitKeyDown = (
        index: number,
        e: KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === "Backspace" && !digits[index] && index > 0) {
            codeRefs.current[index - 1]?.focus();
        }
        if (e.key === "ArrowLeft" && index > 0) {
            codeRefs.current[index - 1]?.focus();
        }
        if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
            codeRefs.current[index + 1]?.focus();
        }
    };

    const handleDigitPaste = (e: ClipboardEvent<HTMLInputElement>) => {
        const pasted = e.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, CODE_LENGTH);

        if (!pasted) return;
        e.preventDefault();

        const next = emptyDigits();
        pasted.split("").forEach((d, i) => {
            next[i] = d;
        });
        setDigits(next);
        if (error) setError("");

        codeRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
    };

    const handleCodeSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (code.length !== CODE_LENGTH) {
            setError("Enter all 6 digits from the email.");
            return;
        }

        setLoading(true);
        setError("");
        setInfo("");

        try {
            await verifyResetCode(email.trim(), code);
            setStep("password");
        } catch (err) {
            setError(errorMessage(err, "Could not verify the code."));
            setDigits(emptyDigits());
            codeRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    };

    /* -------------------------------------------------------------- */
    /* Step 3: new password                                            */
    /* -------------------------------------------------------------- */

    const validatePasswords = () => {
        if (password.length < MIN_PASSWORD) {
            return `Password must be at least ${MIN_PASSWORD} characters`;
        }
        if (password.length > MAX_PASSWORD) {
            return `Password must be at most ${MAX_PASSWORD} characters`;
        }
        if (password !== confirm) return "Passwords do not match";
        return "";
    };

    const handlePasswordSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const problem = validatePasswords();
        setPasswordError(problem);
        if (problem) return;

        setLoading(true);
        setError("");

        try {
            await resetPassword({
                email: email.trim(),
                code,
                newPassword: password,
            });
            setStep("done");
        } catch (err) {
            const message = errorMessage(
                err,
                "Could not reset the password. Please try again."
            );

            // The code died (expired, or too many wrong tries): go back and ask for a new one.
            if (/code|attempt/i.test(message)) {
                setDigits(emptyDigits());
                setPassword("");
                setConfirm("");
                setStep("code");
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const startOver = () => {
        setStep("email");
        setError("");
        setInfo("");
        setDigits(emptyDigits());
        setPassword("");
        setConfirm("");
        setPasswordError("");
        setCooldown(0);
    };

    /* -------------------------------------------------------------- */
    /* Text per step                                                   */
    /* -------------------------------------------------------------- */

    const heading: Record<Step, { title: string; text: string }> = {
        email: {
            title: "Forgot your password?",
            text: "Enter your email and we will send you a 6-digit code.",
        },
        code: {
            title: "Check your email",
            text: `Enter the 6-digit code sent to ${email.trim()}.`,
        },
        password: {
            title: "Create a new password",
            text: "Choose a password you have not used here before.",
        },
        done: {
            title: "Password updated",
            text: "You can now sign in with your new password.",
        },
    };

    const lengthOk = password.length >= MIN_PASSWORD;
    const matchOk = confirm.length > 0 && password === confirm;

    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#14141e] to-[#1a1a2e] p-4 sm:p-6 lg:p-8">
            <div className="w-full max-w-md">
                {/* Brand */}
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

                    {/* Progress */}
                    {step !== "done" && (
                        <div
                            className="relative mb-6 flex gap-2"
                            aria-hidden="true"
                        >
                            {[0, 1, 2].map((i) => (
                                <span
                                    key={i}
                                    className={`h-1 flex-1 rounded-full transition-colors ${i <= STEP_INDEX[step]
                                        ? "bg-blue-500"
                                        : "bg-white/10"
                                        }`}
                                />
                            ))}
                        </div>
                    )}

                    {/* Heading */}
                    <div className="relative mb-7 text-center">
                        {step === "done" && (
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
                                <FiCheckCircle size={28} />
                            </div>
                        )}

                        <h2 className="font-heading text-2xl font-semibold tracking-tight text-white! sm:text-3xl">
                            {heading[step].title}
                        </h2>

                        <p className="mt-1.5 text-sm text-white/60">
                            {heading[step].text}
                        </p>
                    </div>

                    {/* Info */}
                    {info && !error && (
                        <div
                            role="status"
                            className="relative mb-5 flex items-start gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300"
                        >
                            <FiCheck size={18} className="mt-0.5 shrink-0" />
                            <span>{info}</span>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div
                            role="alert"
                            className="relative mb-5 flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                        >
                            <FiAlertCircle size={18} className="shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Step 1: email */}
                    {step === "email" && (
                        <form
                            onSubmit={handleEmailSubmit}
                            className="relative space-y-5"
                            noValidate
                        >
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
                                        onChange={(e) => {
                                            setEmail(e.target.value);
                                            if (emailError) setEmailError("");
                                            if (error) setError("");
                                        }}
                                        disabled={loading}
                                        aria-invalid={!!emailError}
                                        className={inputClass(!!emailError)}
                                    />
                                </div>

                                {emailError && (
                                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
                                        <FiAlertCircle size={14} />
                                        {emailError}
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className={primaryButtonClass}
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {loading ? (
                                        <>
                                            <Spinner />
                                            Sending code...
                                        </>
                                    ) : (
                                        "Send code"
                                    )}
                                </span>

                                {!loading && (
                                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                                )}
                            </button>
                        </form>
                    )}

                    {/* Step 2: code */}
                    {step === "code" && (
                        <form
                            onSubmit={handleCodeSubmit}
                            className="relative space-y-5"
                            noValidate
                        >
                            <div>
                                <label
                                    htmlFor="code-0"
                                    className="mb-1.5 block text-sm font-medium text-white/80"
                                >
                                    Verification code
                                </label>

                                <div className="flex justify-between gap-2">
                                    {digits.map((digit, i) => (
                                        <input
                                            key={i}
                                            id={`code-${i}`}
                                            ref={(el) => {
                                                codeRefs.current[i] = el;
                                            }}
                                            type="text"
                                            inputMode="numeric"
                                            autoComplete={
                                                i === 0 ? "one-time-code" : "off"
                                            }
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) =>
                                                handleDigitChange(i, e.target.value)
                                            }
                                            onKeyDown={(e) =>
                                                handleDigitKeyDown(i, e)
                                            }
                                            onPaste={handleDigitPaste}
                                            onFocus={(e) => e.target.select()}
                                            disabled={loading}
                                            aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
                                            className={`h-12 w-full min-w-0 rounded-xl border bg-white/5 text-center font-heading text-lg font-semibold text-white outline-none transition-all duration-200 hover:border-white/20 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${error
                                                ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                                                : "border-white/10 focus:border-blue-400 focus:ring-blue-400/20"
                                                }`}
                                        />
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading || code.length !== CODE_LENGTH}
                                className={primaryButtonClass}
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {loading ? (
                                        <>
                                            <Spinner />
                                            Verifying...
                                        </>
                                    ) : (
                                        "Verify code"
                                    )}
                                </span>

                                {!loading && (
                                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                                )}
                            </button>

                            <div className="flex flex-col items-center gap-2 text-sm sm:flex-row sm:justify-between">
                                <button
                                    type="button"
                                    onClick={() => sendCode(true)}
                                    disabled={loading || cooldown > 0}
                                    className="font-medium text-blue-400 transition-colors hover:text-blue-300 disabled:cursor-not-allowed disabled:text-white/30"
                                >
                                    {cooldown > 0
                                        ? `Resend code in ${cooldown}s`
                                        : "Resend code"}
                                </button>

                                <button
                                    type="button"
                                    onClick={startOver}
                                    disabled={loading}
                                    className="text-white/50 transition-colors hover:text-white/80 disabled:opacity-50"
                                >
                                    Use a different email
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Step 3: new password */}
                    {step === "password" && (
                        <form
                            onSubmit={handlePasswordSubmit}
                            className="relative space-y-5"
                            noValidate
                        >
                            <div>
                                <label
                                    htmlFor="new-password"
                                    className="mb-1.5 block text-sm font-medium text-white/80"
                                >
                                    New password
                                </label>

                                <div className="relative">
                                    <FiLock
                                        size={18}
                                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"
                                    />

                                    <input
                                        id="new-password"
                                        name="new-password"
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="new-password"
                                        placeholder="At least 8 characters"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            if (passwordError) setPasswordError("");
                                            if (error) setError("");
                                        }}
                                        disabled={loading}
                                        aria-invalid={!!passwordError}
                                        className={`${inputClass(!!passwordError)} pr-11`}
                                    />

                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        disabled={loading}
                                        aria-label={
                                            showPassword
                                                ? "Hide password"
                                                : "Show password"
                                        }
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {showPassword ? (
                                            <FiEyeOff size={18} />
                                        ) : (
                                            <FiEye size={18} />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label
                                    htmlFor="confirm-password"
                                    className="mb-1.5 block text-sm font-medium text-white/80"
                                >
                                    Confirm new password
                                </label>

                                <div className="relative">
                                    <FiLock
                                        size={18}
                                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"
                                    />

                                    <input
                                        id="confirm-password"
                                        name="confirm-password"
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="new-password"
                                        placeholder="Type it again"
                                        value={confirm}
                                        onChange={(e) => {
                                            setConfirm(e.target.value);
                                            if (passwordError) setPasswordError("");
                                            if (error) setError("");
                                        }}
                                        disabled={loading}
                                        aria-invalid={!!passwordError}
                                        className={inputClass(!!passwordError)}
                                    />
                                </div>

                                {passwordError && (
                                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400">
                                        <FiAlertCircle size={14} />
                                        {passwordError}
                                    </p>
                                )}
                            </div>

                            <ul className="space-y-1.5 text-xs">
                                <li
                                    className={`flex items-center gap-2 ${lengthOk ? "text-blue-400" : "text-white/40"
                                        }`}
                                >
                                    <FiCheck size={14} />
                                    At least {MIN_PASSWORD} characters
                                </li>
                                <li
                                    className={`flex items-center gap-2 ${matchOk ? "text-blue-400" : "text-white/40"
                                        }`}
                                >
                                    <FiCheck size={14} />
                                    Both passwords match
                                </li>
                            </ul>

                            <button
                                type="submit"
                                disabled={loading}
                                className={primaryButtonClass}
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {loading ? (
                                        <>
                                            <Spinner />
                                            Saving...
                                        </>
                                    ) : (
                                        "Reset password"
                                    )}
                                </span>

                                {!loading && (
                                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                                )}
                            </button>
                        </form>
                    )}

                    {/* Step 4: done */}
                    {step === "done" && (
                        <div className="relative space-y-4">
                            <p className="text-center text-sm text-white/50">
                                For your safety, you were signed out on every
                                device.
                            </p>

                            <Link
                                href="/login"
                                className={`${primaryButtonClass} flex items-center justify-center`}
                            >
                                Back to sign in
                            </Link>
                        </div>
                    )}

                    {/* Back to login */}
                    {step !== "done" && (
                        <div className="relative mt-6 text-center">
                            <Link
                                href="/login"
                                className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white/80"
                            >
                                <FiArrowLeft size={14} />
                                Back to sign in
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
