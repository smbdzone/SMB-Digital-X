import React from 'react'
import Link from 'next/link'
import { FiPlus, FiLoader } from 'react-icons/fi'

interface ButtonEmeraldProps {
    children?: React.ReactNode
    href?: string
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    icon?: React.ReactNode
    className?: string
}

const ButtonEmerald = ({
    children = 'Add Employee',
    href,
    onClick,
    type = 'button',
    disabled = false,
    loading = false,
    icon,
    className = '',
}: ButtonEmeraldProps) => {

    const isDisabled = disabled || loading

    const content = (
        <>
            {loading ? (
                <FiLoader className="size-4 animate-spin" />
            ) : (
                icon
            )}

            <span>
                {loading ? 'Please wait...' : children}
            </span>
        </>
    )

    const classes = `
        group relative inline-flex h-12 items-center justify-center gap-2
        overflow-hidden rounded-xl
        bg-gradient-to-r from-blue-500 to-blue-600
        px-5 text-sm font-semibold text-white
        shadow-lg shadow-blue-500/25
        transition-all duration-300
        hover:scale-[1.02]
        hover:shadow-xl hover:shadow-blue-500/30
        active:scale-[0.98]
        focus:outline-none focus:ring-2
        focus:ring-blue-500/40 focus:ring-offset-2
        disabled:pointer-events-none disabled:cursor-not-allowed
        disabled:opacity-60 disabled:hover:scale-100
        ${className}
    `

    // Next.js link
    if (href) {
        return (
            <Link
                href={href}
                className={classes}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : undefined}
                onClick={(e) => {
                    if (isDisabled) {
                        e.preventDefault()
                        return
                    }

                    onClick?.()
                }}
            >
                {/* Hover shine */}
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                <span className="relative flex items-center gap-2">
                    {content}
                </span>
            </Link>
        )
    }

    // Normal button
    return (
        <button
            type={type}
            disabled={isDisabled}
            onClick={onClick}
            className={classes}
        >
            {/* Hover shine */}
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

            <span className="relative flex items-center gap-2">
                {content}
            </span>
        </button>
    )
}

export default ButtonEmerald