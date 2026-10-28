'use client'

import React from 'react'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'

interface PaginationProps {
    page: number
    pages: number
    total: number
    onChange: (page: number) => void
    disabled?: boolean
}

const Pagination = ({ page, pages, total, onChange, disabled }: PaginationProps) => {
    if (pages <= 1) {
        return total > 0 ? <p className="px-1 pt-3 text-xs text-charcoal/40">{total} record{total === 1 ? '' : 's'}</p> : null
    }
    return (
        <div className="flex items-center justify-between gap-3 pt-4">
            <p className="text-xs text-charcoal/50">Page {page} of {pages} ({total} records)</p>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onChange(page - 1)}
                    disabled={disabled || page <= 1}
                    className="flex size-9 items-center justify-center rounded-lg border border-charcoal/10 bg-white text-charcoal/70 transition hover:bg-charcoal/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                >
                    <FiChevronLeft className="size-4" />
                </button>
                <button
                    type="button"
                    onClick={() => onChange(page + 1)}
                    disabled={disabled || page >= pages}
                    className="flex size-9 items-center justify-center rounded-lg border border-charcoal/10 bg-white text-charcoal/70 transition hover:bg-charcoal/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                >
                    <FiChevronRight className="size-4" />
                </button>
            </div>
        </div>
    )
}

export default Pagination
