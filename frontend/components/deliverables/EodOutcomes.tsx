'use client'

import React from 'react'
import { FiMessageSquare } from 'react-icons/fi'
import { TaskStatusButton } from '@/components/ui/shared'
import { Deliverable, DeliverableOutcome, OutcomeInput } from '@/services/deliverable.services'

export interface OutcomeDraft {
    outcome: DeliverableOutcome
    note: string
    actualHours: string
    taskProgress: string
    carry: boolean
    showDetails: boolean
}

/** The form state for each deliverable, from what is saved (edit) or sensible defaults (new report). */
export const initialOutcomes = (items: Deliverable[]): Record<string, OutcomeDraft> =>
    Object.fromEntries(items.map(item => {
        const outcome: DeliverableOutcome = item.outcome ?? 'not_started'
        const progress = item.taskProgress ?? item.taskId?.progress
        return [item._id, {
            outcome,
            note: item.outcomeNote ?? '',
            actualHours: item.actualHours === null || item.actualHours === undefined ? '' : String(item.actualHours),
            taskProgress: progress === null || progress === undefined ? '' : String(progress),
            // Unfinished work carries to tomorrow unless the employee unticks it
            carry: item.reportedAt ? !!item.carriedTo : true,
            showDetails: !!(item.outcomeNote || item.actualHours),
        }]
    }))

/** Same formula as the backend: (completed + 0.5 x half completed) / all items of the day. */
export const calculatedProgress = (drafts: OutcomeDraft[]): number => {
    if (drafts.length === 0) return 0
    const completed = drafts.filter(d => d.outcome === 'completed').length
    const half = drafts.filter(d => d.outcome === 'in_progress').length
    return Math.round(((completed + 0.5 * half) / drafts.length) * 100)
}

/** Validates and turns the form state into the API payload. Returns an error message instead when invalid. */
export const toOutcomePayload = (items: Deliverable[], drafts: Record<string, OutcomeDraft>):
    { outcomes: OutcomeInput[]; carryOver: string[] } | string => {
    const outcomes: OutcomeInput[] = []
    const carryOver: string[] = []
    for (const item of items) {
        const d = drafts[item._id]
        if (!d) continue
        let actualHours: number | null = null
        if (d.actualHours !== '') {
            const n = Number(d.actualHours)
            if (!Number.isFinite(n) || n < 0 || n > 24) return `Actual hours for "${item.title}" must be between 0 and 24`
            actualHours = n
        }
        let taskProgress: number | null = null
        if (item.taskId && d.outcome === 'in_progress' && d.taskProgress !== '') {
            const n = Number(d.taskProgress)
            if (!Number.isFinite(n) || n < 0 || n > 100) return `Task progress for "${item.title}" must be between 0 and 100`
            taskProgress = Math.round(n)
        }
        outcomes.push({ deliverableId: item._id, outcome: d.outcome, outcomeNote: d.note.trim(), actualHours, taskProgress })
        if (d.outcome !== 'completed' && d.carry && !item.carriedTo) carryOver.push(item._id)
    }
    return { outcomes, carryOver }
}

interface EodOutcomesProps {
    items: Deliverable[]
    drafts: Record<string, OutcomeDraft>
    onChange: (id: string, patch: Partial<OutcomeDraft>) => void
}

/** One card per deliverable: what happened to it, optional note/hours, and whether it carries to tomorrow. */
const EodOutcomes = ({ items, drafts, onChange }: EodOutcomesProps) => (
    <div className="space-y-2">
        {items.map(item => {
            const d = drafts[item._id]
            if (!d) return null
            const unfinished = d.outcome !== 'completed'
            return (
                <div key={item._id} className="rounded-xl border border-charcoal/5 p-3 sm:p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="break-words text-sm font-semibold">{item.title}</p>
                            {(item.projectId || item.taskId) && (
                                <p className="mt-0.5 text-xs text-charcoal/40">
                                    {[item.projectId?.name, item.taskId ? 'Assigned task' : ''].filter(Boolean).join(' · ')}
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => onChange(item._id, { showDetails: !d.showDetails })}
                            className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${d.showDetails ? 'bg-blue-50 text-blue-600' : 'text-charcoal/40 hover:bg-charcoal/5'}`}
                            aria-label="Add a note or hours"
                        >
                            <FiMessageSquare className="size-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <TaskStatusButton active={d.outcome === 'not_started'} onClick={() => onChange(item._id, { outcome: 'not_started' })}>Not started</TaskStatusButton>
                        <TaskStatusButton active={d.outcome === 'in_progress'} type="progress" onClick={() => onChange(item._id, { outcome: 'in_progress' })}>Half completed</TaskStatusButton>
                        <TaskStatusButton active={d.outcome === 'completed'} type="completed" onClick={() => onChange(item._id, { outcome: 'completed' })}>Completed</TaskStatusButton>
                    </div>

                    {item.taskId && d.outcome === 'in_progress' && (
                        <label className="mt-3 flex items-center justify-between gap-3 text-xs text-charcoal/60">
                            <span>Task progress %</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={99}
                                value={d.taskProgress}
                                onChange={e => onChange(item._id, { taskProgress: e.target.value })}
                                className="h-10 w-24 rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </label>
                    )}

                    {d.showDetails && (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
                            <input
                                value={d.note}
                                maxLength={1000}
                                onChange={e => onChange(item._id, { note: e.target.value })}
                                placeholder="Note (optional)"
                                className="h-10 rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                            <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={24}
                                step={0.25}
                                value={d.actualHours}
                                onChange={e => onChange(item._id, { actualHours: e.target.value })}
                                placeholder="Hours spent"
                                className="h-10 rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>
                    )}

                    {/* Already carried when the report was first sent: the copy stays (marking it Completed removes it) */}
                    {unfinished && item.carriedTo && (
                        <p className="mt-3 text-xs font-medium text-charcoal/50">Carried to tomorrow</p>
                    )}
                    {unfinished && !item.carriedTo && (
                        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-charcoal/60">
                            <input
                                type="checkbox"
                                checked={d.carry}
                                onChange={e => onChange(item._id, { carry: e.target.checked })}
                                className="size-4 accent-blue-600"
                            />
                            Carry to tomorrow{d.outcome === 'in_progress' ? ' (stays Half completed)' : ''}
                        </label>
                    )}
                </div>
            )
        })}
    </div>
)

export default EodOutcomes
