import React from 'react'

type Variant = 'project' | 'employee' | 'eod' | 'task' | 'expense' | 'salary' | 'email'

interface StatusBadgeProps {
    status: string
    variant?: Variant
    className?: string
}

const variantStyles: Record<Variant, Record<string, string>> = {
    project: {
        Planning: 'bg-gray-100 text-gray-700',
        Active: 'bg-emerald-100 text-emerald-700',
        Completed: 'bg-blue-100 text-blue-700',
        'On Hold': 'bg-amber-100 text-amber-700',
    },
    employee: {
        active: 'bg-green-100 text-green-800',
        inactive: 'bg-red-100 text-red-800',
    },
    eod: {
        Submitted: 'bg-yellow-100 text-yellow-800',
        Reviewed: 'bg-green-100 text-green-800',
    },
    task: {
        Todo: 'bg-gray-100 text-gray-600',
        'In Progress': 'bg-blue-50 text-blue-600',
        Review: 'bg-amber-50 text-amber-600',
        Completed: 'bg-emerald-50 text-emerald-600',
    },
    expense: {
        pending: 'bg-amber-50 text-amber-700',
        approved: 'bg-blue-50 text-blue-700',
        rejected: 'bg-red-50 text-red-700',
        reimbursed: 'bg-emerald-50 text-emerald-700',
    },
    salary: {
        pending: 'bg-amber-50 text-amber-700',
        paid: 'bg-emerald-50 text-emerald-700',
    },
    email: {
        not_sent: 'bg-gray-100 text-gray-600',
        sent: 'bg-emerald-50 text-emerald-700',
        failed: 'bg-red-50 text-red-700',
    },
}

export const StatusBadge = ({ status, variant = 'project', className = '' }: StatusBadgeProps) => {
    const classes = variantStyles[variant]?.[status] || 'bg-gray-100 text-gray-600'
    return (
        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${classes} ${className}`}>
            {status.replace(/_/g, ' ')}
        </span>
    )
}

// Convenience components
export const ProjectStatus = ({ status }: { status: string }) => (
    <StatusBadge status={status} variant="project" />
)
