import React from 'react'

export const ReportSection = ({ title, content }: { title: string; content: string }) => (
    <div>
        <h4 className="mb-2 text-sm font-semibold">{title}</h4>
        <div className="rounded-xl bg-charcoal/[0.03] p-4 text-sm leading-6 text-charcoal/55">{content}</div>
    </div>
)
