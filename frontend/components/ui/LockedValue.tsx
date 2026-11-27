import React from 'react'
import { FiLock } from 'react-icons/fi'

/**
 * Shown instead of a finance figure (budgets, milestone payments, company-wide totals). Those figures are set and
 * calculated only in the Owner Console; once locking has started the database holds them as locked values that only
 * the console can read. The website never receives them.
 */
export const LOCKED_TEXT = 'Locked: view in the Owner Console'

const LockedValue = ({ className = '' }: { className?: string }) => (
    <span data-locked="1" className={`inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 ${className}`}>
        <FiLock className="size-3.5 shrink-0" />
        {LOCKED_TEXT}
    </span>
)

export default LockedValue
