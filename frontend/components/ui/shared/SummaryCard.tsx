import React from 'react'

export const SummaryCard = ({
    title,
    value,
    subtitle,
}: {
    title: string
    value: number | string
    subtitle?: string
}) => (
    <div className="rounded-xl border border-charcoal/5 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium text-charcoal/40">{title}</p>
        <p className="mt-2 text-2xl font-bold font-heading">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-charcoal/50">{subtitle}</p>}
    </div>
)
