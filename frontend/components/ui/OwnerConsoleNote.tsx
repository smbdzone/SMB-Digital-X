import React from 'react'
import { FiLock } from 'react-icons/fi'

/** Shown where owner actions used to be: they are now done in the Owner Console (signed and recorded). */
const OwnerConsoleNote = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
    <div className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}>
        <FiLock className="mt-0.5 size-4 shrink-0" />
        <span>{children ?? 'This action is done in the Owner Console.'}</span>
    </div>
)

export default OwnerConsoleNote
