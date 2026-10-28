import React from 'react'

export const InfoBox = ({ title, value }: { title: string; value: string }) => (
    <div className="rounded-xl border border-charcoal/5 bg-charcoal/[0.02] p-4">
        <p className="text-xs text-charcoal/40">{title}</p>
        <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
)