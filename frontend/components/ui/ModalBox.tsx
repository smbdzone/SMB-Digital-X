'use client'

import React, { useEffect } from 'react'
import { FiX } from 'react-icons/fi'

interface ModalBoxProps {
    open: boolean
    onClose: () => void

    title?: string
    description?: string

    children: React.ReactNode
    footer?: React.ReactNode

    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl'
    closeOnOverlayClick?: boolean
    closeOnEscape?: boolean
    showCloseButton?: boolean

    className?: string
}

const ModalBox = ({
    open,
    onClose,

    title,
    description,

    children,
    footer,

    size = 'md',
    closeOnOverlayClick = true,
    closeOnEscape = true,
    showCloseButton = true,

    className = '',
}: ModalBoxProps) => {

    useEffect(() => {
        if (!open || !closeOnEscape) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose()
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [open, closeOnEscape, onClose])

    useEffect(() => {
        if (!open) return

        const originalOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = originalOverflow
        }
    }, [open])

    if (!open) return null

    const sizes = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        "4xl": 'max-w-4xl'
    }

    const handleOverlayClick = (
        e: React.MouseEvent<HTMLDivElement>
    ) => {
        if (e.target === e.currentTarget && closeOnOverlayClick) {
            onClose()
        }
    }

    return (
        <div
            className="
                fixed inset-0 z-50
                flex items-center justify-center
                bg-charcoal/60
                backdrop-blur-sm
                p-4
            "
            onMouseDown={handleOverlayClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
        >
            <div
                className={`
                    relative w-full ${sizes[size]}
                    max-h-[90vh]
                    overflow-hidden
                    rounded-2xl
                    border border-black/5
                    bg-white
                    shadow-2xl shadow-black/10
                    animate-in fade-in zoom-in-95
                    duration-200
                    ${className}
                `}
                onMouseDown={(e) => e.stopPropagation()}
            >

                {/* Header */}
                {(title || description || showCloseButton) && (
                    <div className="flex items-start justify-between gap-4 border-b border-black/5 px-6 py-5">

                        <div className="min-w-0">
                            {title && (
                                <h2
                                    id="modal-title"
                                    className="text-lg font-semibold text-charcoal"
                                >
                                    {title}
                                </h2>
                            )}

                            {description && (
                                <p className="mt-1 text-sm leading-6 text-charcoal/60">
                                    {description}
                                </p>
                            )}
                        </div>

                        {showCloseButton && (
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close modal"
                                className="
                                    flex size-9 shrink-0 items-center
                                    justify-center rounded-lg
                                    text-charcoal/50
                                    transition-all
                                    hover:bg-charcoal/5
                                    hover:text-charcoal
                                    active:scale-95
                                "
                            >
                                <FiX className="size-5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-6 py-6">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex items-center justify-end gap-3 border-t border-black/5 bg-charcoal/[0.015] px-6 py-4">
                        {footer}
                    </div>
                )}

            </div>
        </div>
    )
}

export default ModalBox