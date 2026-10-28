'use client'

import React, { forwardRef, useState } from 'react'
import { FiEye, FiEyeOff } from 'react-icons/fi'

interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string
    value: string | number;
    handleChange: (
        e: React.ChangeEvent<HTMLInputElement>
    ) => void
    error?: string
    helperText?: string
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
    containerClassName?: string
    labelClassName?: string
    showPasswordToggle?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    (
        {
            value,
            handleChange,
            label,
            error,
            helperText,
            leftIcon,
            rightIcon,
            containerClassName = '',
            labelClassName = '',
            showPasswordToggle = false,
            type = 'text',
            className = '',
            required,
            disabled,
            ...props
        },
        ref
    ) => {
        const [showPassword, setShowPassword] = useState(false)

        const isPassword = type === 'password'

        const inputType =
            isPassword && showPassword ? 'text' : type

        return (
            <div className={`w-full ${containerClassName}`}>

                {/* Label */}
                {label && (
                    <label
                        className={`
                            mb-2 block text-sm font-medium
                            text-charcoal
                            ${labelClassName}
                        `}
                    >
                        {label}

                        {required && (
                            <span className="ml-1 text-red-500">
                                *
                            </span>
                        )}
                    </label>
                )}

                {/* Input wrapper */}
                <div className="relative">

                    {/* Left icon */}
                    {leftIcon && (
                        <div
                            className="
                                pointer-events-none
                                absolute left-3 top-1/2
                                -translate-y-1/2
                                text-charcoal/40
                            "
                        >
                            {leftIcon}
                        </div>
                    )}

                    <input
                        ref={ref}
                        {...props}
                        value={value}
                        onChange={handleChange}
                        type={inputType}
                        disabled={disabled}
                        required={required}
                        className={`
                            h-11 w-full
                            rounded-xl
                            border
                            bg-surface
                            px-3
                            text-sm text-charcoal
                            outline-none
                            transition-all duration-200

                            placeholder:text-charcoal/35

                            ${leftIcon ? 'pl-10' : ''}

                            ${rightIcon ||
                                (isPassword && showPasswordToggle)
                                ? 'pr-10'
                                : ''
                            }

                            ${error
                                ? `
                                        border-red-400
                                        focus:border-red-500
                                        focus:ring-4
                                        focus:ring-red-500/10
                                    `
                                : `
                                        border-charcoal/10
                                        hover:border-charcoal/20
                                        focus:border-blue-500
                                        focus:ring-4
                                        focus:ring-blue-500/10
                                    `
                            }

                            disabled:cursor-not-allowed
                            disabled:bg-charcoal/3
                            disabled:opacity-60

                            ${className}
                        `}

                    />

                    {/* Password toggle */}
                    {isPassword && showPasswordToggle && (
                        <button
                            type="button"
                            onClick={() =>
                                setShowPassword((prev) => !prev)
                            }
                            disabled={disabled}
                            tabIndex={-1}
                            className="
                                absolute right-3 top-1/2
                                -translate-y-1/2
                                text-charcoal/40
                                transition-colors
                                hover:text-charcoal
                                disabled:pointer-events-none
                            "
                            aria-label={
                                showPassword
                                    ? 'Hide password'
                                    : 'Show password'
                            }
                        >
                            {showPassword ? (
                                <FiEyeOff className="size-4" />
                            ) : (
                                <FiEye className="size-4" />
                            )}
                        </button>
                    )}

                    {/* Right icon */}
                    {!(
                        isPassword && showPasswordToggle
                    ) &&
                        rightIcon && (
                            <div
                                className="
                                    pointer-events-none
                                    absolute right-3 top-1/2
                                    -translate-y-1/2
                                    text-charcoal/40
                                "
                            >
                                {rightIcon}
                            </div>
                        )}
                </div>

                {/* Error */}
                {error && (
                    <p className="mt-1.5 text-xs font-medium text-red-500">
                        {error}
                    </p>
                )}

                {/* Helper text */}
                {!error && helperText && (
                    <p className="mt-1.5 text-xs text-charcoal/50">
                        {helperText}
                    </p>
                )}
            </div>
        )
    }
)

Input.displayName = 'Input'

export default Input