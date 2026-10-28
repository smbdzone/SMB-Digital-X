import React from 'react'

export const TaskStatusButton = ({ children, active, type = 'none', onClick }: {
    children: React.ReactNode
    active: boolean
    type?: 'none' | 'progress' | 'completed'
    onClick: () => void
}) => {
    let activeClass = 'bg-charcoal text-white'
    if (type === 'progress') activeClass = 'bg-blue-500 text-white'
    if (type === 'completed') activeClass = 'bg-emerald-500 text-white'

    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${active ? activeClass : 'bg-charcoal/[0.04] text-charcoal/50 hover:bg-charcoal/[0.08]'}`}
        >
            {children}
        </button>
    )
}