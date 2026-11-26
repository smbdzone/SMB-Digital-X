'use client'

import React, { useState } from 'react'
import { FiBriefcase, FiClock, FiCornerDownRight, FiEdit3 } from 'react-icons/fi'
import { StatusBadge } from '@/components/ui/shared'
import { formatDayKey } from '@/lib/eodDate'
import {
    APPROVAL_LABELS, Deliverable, OUTCOME_LABELS, SOURCE_LABELS,
} from '@/services/deliverable.services'

const hours = (h?: number | null) => (h === null || h === undefined ? null : `${h}h`)

interface DeliverableItemProps {
    item: Deliverable
    /** Buttons shown on the right (edit, remove, move...) */
    actions?: React.ReactNode
    /** Hide the approval badge (e.g. inside an approval queue where everything is pending) */
    hideApproval?: boolean
    /** Something extra under the item (e.g. the EOD outcome picker) */
    children?: React.ReactNode
}

/** One deliverable as a card. Mobile first: badges wrap, actions stay on the title line. */
const DeliverableItem = ({ item, actions, hideApproval = false, children }: DeliverableItemProps) => {
    const [showOriginal, setShowOriginal] = useState(false)
    const est = hours(item.estimatedHours)
    const actual = hours(item.actualHours)
    const source = SOURCE_LABELS[item.source]

    return (
        <div className="rounded-xl border border-charcoal/5 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-charcoal">{item.title}</p>
                    {item.description && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-charcoal/55">{item.description}</p>
                    )}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={item.priority} variant="priority" label={item.priority} />
                {!hideApproval && (
                    <StatusBadge status={item.approvalStatus} variant="approval" label={APPROVAL_LABELS[item.approvalStatus]} />
                )}
                {item.outcome && (
                    <StatusBadge status={item.outcome} variant="outcome" label={OUTCOME_LABELS[item.outcome]} />
                )}
                {source && (
                    <span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{source}</span>
                )}
                {item.editedByApprover && (
                    <button
                        type="button"
                        onClick={() => setShowOriginal(v => !v)}
                        className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700"
                        title="Show what was changed"
                    >
                        <FiEdit3 className="size-3" /> Changed{item.editedBy?.name ? ` by ${item.editedBy.name}` : ''}
                    </button>
                )}
            </div>

            {(item.projectId || est || actual || item.taskId || item.carriedTo) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal/50">
                    {item.projectId && <span className="inline-flex items-center gap-1"><FiBriefcase className="size-3.5" />{item.projectId.name}</span>}
                    {(est || actual) && (
                        <span className="inline-flex items-center gap-1">
                            <FiClock className="size-3.5" />
                            {est ? `Est. ${est}` : ''}{est && actual ? ' · ' : ''}{actual ? `Actual ${actual}` : ''}
                        </span>
                    )}
                    {item.taskId && typeof item.taskId.progress === 'number' && (
                        <span>Task {item.taskProgress ?? item.taskId.progress}%</span>
                    )}
                    {item.carriedTo && (
                        <span className="inline-flex items-center gap-1"><FiCornerDownRight className="size-3.5" />Carried to {formatDayKey(item.carriedTo)}</span>
                    )}
                </div>
            )}

            {item.outcomeNote && (
                <p className="mt-2 rounded-lg bg-charcoal/[0.03] px-3 py-2 text-xs text-charcoal/65">{item.outcomeNote}</p>
            )}

            {showOriginal && item.original && (
                <div className="mt-2 rounded-lg border border-orange-100 bg-orange-50/50 px-3 py-2 text-xs text-charcoal/65">
                    <p className="font-semibold text-orange-700">Before the change</p>
                    {item.original.title !== undefined && <p className="mt-1">Title: {item.original.title}</p>}
                    {item.original.description ? <p className="mt-0.5 whitespace-pre-wrap">Description: {item.original.description}</p> : null}
                    {item.original.priority && <p className="mt-0.5">Priority: {item.original.priority}</p>}
                    {item.original.estimatedHours !== undefined && (
                        <p className="mt-0.5">Estimate: {item.original.estimatedHours === null ? '-' : `${item.original.estimatedHours}h`}</p>
                    )}
                </div>
            )}

            {children}
        </div>
    )
}

export default DeliverableItem
