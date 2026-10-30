'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
    FiAlertCircle, FiArrowDown, FiArrowUp, FiCheck, FiCheckSquare, FiChevronDown,
    FiEdit2, FiPlus, FiSquare, FiTrash2,
} from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    deleteMilestone,
    MILESTONE_PAYMENT_OPTIONS,
    MILESTONE_STATUS_OPTIONS,
    reorderMilestones,
    toggleDeliverable,
    updateMilestonePayment,
    updateMilestoneStatus,
    type Deliverable,
    type Milestone,
    type MilestoneListResponse,
    type MilestonePaymentStatus,
    type MilestoneStatus,
} from '@/services/milestone.services'
import { formatDay } from '@/lib/formatDay'
import { errorMessage, formatCurrency, formatDate } from '@/lib/utils'
import ButtonEmerald from '../ui/ButtonEmerald'
import MilestoneForm from './MilestoneForm'

interface Props {
    projectId: string
    data: MilestoneListResponse | null
    loading: boolean
    error: string | null
    reload: () => Promise<void>
}

type Filter = 'all' | MilestoneStatus | 'overdue'

const statusBadge: Record<MilestoneStatus, string> = {
    pending: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-blue-50 text-blue-700',
    completed: 'bg-emerald-50 text-emerald-700',
    delayed: 'bg-red-50 text-red-700',
}

const paymentBadge: Record<MilestonePaymentStatus, string> = {
    unpaid: 'bg-gray-100 text-gray-700',
    invoiced: 'bg-amber-50 text-amber-700',
    paid: 'bg-emerald-50 text-emerald-700',
}

// Colour of a milestone's slice in the payment bar
const segmentColor: Record<MilestonePaymentStatus, string> = {
    paid: 'bg-emerald-500',
    invoiced: 'bg-amber-400',
    unpaid: 'bg-charcoal/25',
}

const optionLabel = (options: { value: string; label: string }[], value: string) =>
    options.find(o => o.value === value)?.label ?? value

const nodeClass = (m: Milestone) =>
    m.status === 'completed'
        ? 'bg-emerald-500 text-white'
        : m.isOverdue || m.status === 'delayed'
            ? 'bg-red-500 text-white'
            : m.status === 'in_progress'
                ? 'bg-blue-500 text-white'
                : 'border border-charcoal/15 bg-white text-charcoal/50'

const selectClass =
    'h-9 rounded-lg border border-charcoal/10 bg-white px-2 text-xs font-medium text-charcoal outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60'

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
    <div>
        <p className="text-xs text-charcoal/45">{label}</p>
        <p className="mt-1 font-heading text-xl font-bold text-charcoal">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-charcoal/45">{hint}</p>}
    </div>
)

const LegendDot = ({ className, label, value }: { className: string; label: string; value: string }) => (
    <div className="flex items-center gap-2 text-xs text-charcoal/60">
        <span className={`size-2.5 rounded-full ${className}`} />
        <span>{label}</span>
        <span className="font-semibold text-charcoal">{value}</span>
    </div>
)

/* ------------------------------------------------------------------ */
/* One milestone in the timeline                                       */
/* ------------------------------------------------------------------ */

interface ItemProps {
    m: Milestone
    index: number
    open: boolean
    busy: boolean
    canReorder: boolean
    isFirst: boolean
    isLast: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
    onMove: (direction: -1 | 1) => void
    onComplete: () => void
    onStatus: (status: MilestoneStatus) => void
    onPayment: (status: MilestonePaymentStatus) => void
    onDeliverable: (d: Deliverable) => void
}

const MilestoneItem = ({
    m, index, open, busy, canReorder, isFirst, isLast,
    onToggle, onEdit, onDelete, onMove, onComplete, onStatus, onPayment, onDeliverable,
}: ItemProps) => {
    const pct = m.deliverablesTotal ? (m.deliverablesDone / m.deliverablesTotal) * 100 : 0

    return (
        <li className="group flex gap-4">
            {/* Timeline node */}
            <div className="flex flex-col items-center">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${nodeClass(m)}`}>
                    {m.status === 'completed' ? <FiCheck className="size-4" /> : index + 1}
                </div>
                {!isLast && <span className="mt-1 w-px flex-1 bg-charcoal/10" />}
            </div>

            {/* Card */}
            <div className={`mb-4 min-w-0 flex-1 rounded-2xl border bg-white transition ${open ? 'border-blue-200 shadow-sm' : 'border-charcoal/10'} ${isLast ? 'mb-0' : ''}`}>
                <div className="flex items-start gap-2 p-4">
                    <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-heading text-sm font-bold text-charcoal sm:text-base">{m.title}</h4>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge[m.status]}`}>{optionLabel(MILESTONE_STATUS_OPTIONS, m.status)}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentBadge[m.paymentStatus]}`}>{optionLabel(MILESTONE_PAYMENT_OPTIONS, m.paymentStatus)}</span>
                            {m.isOverdue && (
                                <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700"><FiAlertCircle className="size-3.5" /> Overdue</span>
                            )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-charcoal/55">
                            <span className={m.isOverdue ? 'font-semibold text-red-600' : ''}>{m.deadline ? `Due ${formatDay(m.deadline)}` : 'No deadline'}</span>
                            <span><span className="font-semibold text-charcoal">{formatCurrency(m.paymentAmount, m.currency)}</span> ({m.paymentPercentage}%)</span>
                            {m.deliverablesTotal > 0 && (
                                <span className="flex items-center gap-2">
                                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-charcoal/10">
                                        <span className="block h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                                    </span>
                                    {m.deliverablesDone}/{m.deliverablesTotal} delivered
                                </span>
                            )}
                        </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                        {m.status !== 'completed' && (
                            <button
                                type="button"
                                onClick={onComplete}
                                disabled={busy}
                                title="Mark as completed"
                                className="flex size-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                                <FiCheck className="size-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onToggle}
                            aria-label={open ? 'Collapse' : 'Expand'}
                            className="flex size-9 items-center justify-center rounded-lg text-charcoal/50 transition hover:bg-charcoal/[0.05]"
                        >
                            <FiChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                </div>

                {open && (
                    <div className="space-y-5 border-t border-charcoal/5 px-4 pb-4 pt-4">
                        {m.description && <p className="text-sm leading-6 text-charcoal/60">{m.description}</p>}

                        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                            <div><dt className="text-xs text-charcoal/45">Start</dt><dd className="mt-0.5 text-sm font-semibold">{formatDay(m.startDate)}</dd></div>
                            <div><dt className="text-xs text-charcoal/45">Deadline</dt><dd className={`mt-0.5 text-sm font-semibold ${m.isOverdue ? 'text-red-600' : ''}`}>{formatDay(m.deadline)}</dd></div>
                            <div><dt className="text-xs text-charcoal/45">Share of budget</dt><dd className="mt-0.5 text-sm font-semibold">{m.paymentPercentage}%</dd></div>
                            <div><dt className="text-xs text-charcoal/45">Payment</dt><dd className="mt-0.5 text-sm font-semibold">{formatCurrency(m.paymentAmount, m.currency)}</dd></div>
                        </dl>

                        {m.deliverables.length > 0 && (
                            <div>
                                <p className="mb-2 text-xs font-semibold text-charcoal/60">Deliverables</p>
                                <ul className="space-y-1">
                                    {m.deliverables.map(d => (
                                        <li key={d._id}>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => onDeliverable(d)}
                                                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-charcoal/[0.03] disabled:opacity-60"
                                            >
                                                {d.isDone
                                                    ? <FiCheckSquare className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                                                    : <FiSquare className="mt-0.5 size-4 shrink-0 text-charcoal/35" />}
                                                <span className="min-w-0">
                                                    <span className={`block text-sm ${d.isDone ? 'text-charcoal/40 line-through' : 'text-charcoal'}`}>{d.title}</span>
                                                    {d.description && <span className="block text-xs text-charcoal/45">{d.description}</span>}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {m.notes && <p className="rounded-xl bg-charcoal/[0.03] p-3 text-sm leading-6 text-charcoal/60">{m.notes}</p>}

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-charcoal/5 pt-4">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <label className="flex items-center gap-2 text-xs text-charcoal/50">
                                    Status
                                    <select value={m.status} disabled={busy} onChange={e => onStatus(e.target.value as MilestoneStatus)} className={selectClass}>
                                        {MILESTONE_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </label>
                                <label className="flex items-center gap-2 text-xs text-charcoal/50">
                                    Payment
                                    <select value={m.paymentStatus} disabled={busy} onChange={e => onPayment(e.target.value as MilestonePaymentStatus)} className={selectClass}>
                                        {MILESTONE_PAYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </label>
                                {m.completedAt && <span className="text-xs text-charcoal/45">Completed {formatDate(m.completedAt)}</span>}
                                {m.invoicedAt && <span className="text-xs text-charcoal/45">Invoiced {formatDate(m.invoicedAt)}</span>}
                                {m.paidAt && <span className="text-xs text-charcoal/45">Paid {formatDate(m.paidAt)}</span>}
                            </div>

                            <div className="flex items-center gap-1">
                                {canReorder && (
                                    <>
                                        <button onClick={() => onMove(-1)} disabled={busy || isFirst} className="flex size-9 items-center justify-center rounded-lg text-charcoal/50 transition hover:bg-charcoal/[0.05] disabled:opacity-30" title="Move up"><FiArrowUp className="size-4" /></button>
                                        <button onClick={() => onMove(1)} disabled={busy || isLast} className="flex size-9 items-center justify-center rounded-lg text-charcoal/50 transition hover:bg-charcoal/[0.05] disabled:opacity-30" title="Move down"><FiArrowDown className="size-4" /></button>
                                    </>
                                )}
                                <button onClick={onEdit} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"><FiEdit2 className="size-3.5" /> Edit</button>
                                <button onClick={onDelete} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"><FiTrash2 className="size-3.5" /> Delete</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </li>
    )
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

const ProjectMilestones = ({ projectId, data, loading, error, reload }: Props) => {
    const { token } = useAuth()
    const toast = useToast()

    const [filter, setFilter] = useState<Filter>('all')
    const [openIds, setOpenIds] = useState<Set<string>>(new Set())
    const [busyId, setBusyId] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<Milestone | null>(null)
    const opened = useRef(false)

    const milestones = data?.data ?? []
    const summary = data?.summary
    const budget = data?.project.budget ?? 0

    // On first load, open the milestone that needs attention next.
    useEffect(() => {
        if (opened.current || !data) return
        opened.current = true
        const current = data.data.find(m => m.status !== 'completed')
        if (current) setOpenIds(new Set([current._id]))
    }, [data])

    // One change at a time, then reload so all totals stay correct.
    const run = async (id: string, action: (token: string) => Promise<unknown>, success?: string) => {
        if (!token) return
        setBusyId(id)
        try {
            await action(token)
            if (success) toast.showSuccess(success)
            await reload()
        } catch (err) {
            toast.showError(errorMessage(err, 'Something went wrong'))
        } finally {
            setBusyId('')
        }
    }

    // Amounts in the summary have no currency of their own: show one only if all milestones share it.
    const currencies = Array.from(new Set(milestones.map(m => m.currency)))
    const cur = currencies.length === 1 ? currencies[0] : undefined

    const counts: Record<Filter, number> = {
        all: milestones.length,
        pending: milestones.filter(m => m.status === 'pending').length,
        in_progress: milestones.filter(m => m.status === 'in_progress').length,
        completed: milestones.filter(m => m.status === 'completed').length,
        delayed: milestones.filter(m => m.status === 'delayed').length,
        overdue: milestones.filter(m => m.isOverdue).length,
    }

    const chips: { id: Filter; label: string }[] = [
        { id: 'all', label: 'All' },
        { id: 'pending', label: 'Pending' },
        { id: 'in_progress', label: 'In progress' },
        { id: 'completed', label: 'Completed' },
        { id: 'delayed', label: 'Delayed' },
        ...(counts.overdue > 0 ? [{ id: 'overdue' as Filter, label: 'Overdue' }] : []),
    ]

    const visible = milestones.filter(m =>
        filter === 'all' ? true : filter === 'overdue' ? m.isOverdue : m.status === filter
    )

    const toggleOpen = (id: string) =>
        setOpenIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction
        if (target < 0 || target >= milestones.length) return
        const ids = milestones.map(m => m._id)
        ;[ids[index], ids[target]] = [ids[target], ids[index]]
        run('reorder', t => reorderMilestones(t, projectId, ids))
    }

    const openAdd = () => {
        setEditing(null)
        setFormOpen(true)
    }

    const remainingPercent = Math.max(0, (summary?.unallocatedPercent ?? 100) + (editing?.paymentPercentage ?? 0))

    return (
        <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="font-heading text-lg font-bold text-charcoal">Milestones</h3>
                    <p className="mt-1 text-sm text-charcoal/50">Split the project into payment stages and track delivery and payment for each.</p>
                </div>
                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAdd}>Add milestone</ButtonEmerald>
            </div>

            {loading && !data ? (
                <p className="rounded-2xl border border-charcoal/5 bg-white py-12 text-center text-sm text-charcoal/50 shadow-sm">Loading milestones...</p>
            ) : error && !data ? (
                <p className="rounded-2xl border border-charcoal/5 bg-white py-12 text-center text-sm text-red-500 shadow-sm">{error}</p>
            ) : (
                <>
                    {/* Payment plan */}
                    {summary && (
                        <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                            <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
                                <Stat label="Project budget" value={formatCurrency(summary.budget, cur)} />
                                <Stat label="Allocated" value={`${summary.allocatedPercent}%`} hint={`${formatCurrency(summary.allocatedAmount, cur)} planned`} />
                                <Stat label="Paid" value={formatCurrency(summary.paidAmount, cur)} hint={summary.allocatedAmount > 0 ? `${Math.round((summary.paidAmount / summary.allocatedAmount) * 100)}% of planned` : undefined} />
                                <Stat label="Delivery" value={`${summary.progressPercent}%`} hint={`${summary.completed} of ${summary.total} completed`} />
                            </div>

                            {/* Budget split bar: one slice per milestone, coloured by payment status */}
                            <div className="mt-6">
                                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-charcoal/[0.06]">
                                    {milestones.filter(m => m.paymentPercentage > 0).map(m => (
                                        <span
                                            key={m._id}
                                            className={`h-full ${segmentColor[m.paymentStatus]}`}
                                            style={{ flex: `0 1 ${m.paymentPercentage}%` }}
                                            title={`${m.title}: ${m.paymentPercentage}% - ${formatCurrency(m.paymentAmount, m.currency)} (${optionLabel(MILESTONE_PAYMENT_OPTIONS, m.paymentStatus)})`}
                                        />
                                    ))}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                                    <LegendDot className="bg-emerald-500" label="Paid" value={formatCurrency(summary.paidAmount, cur)} />
                                    <LegendDot className="bg-amber-400" label="Invoiced" value={formatCurrency(summary.invoicedAmount, cur)} />
                                    <LegendDot className="bg-charcoal/25" label="Not invoiced" value={formatCurrency(summary.unpaidAmount, cur)} />
                                    <LegendDot className="bg-charcoal/[0.08] ring-1 ring-charcoal/10" label="Unallocated" value={`${formatCurrency(summary.unallocatedAmount, cur)} (${summary.unallocatedPercent}%)`} />
                                </div>
                            </div>

                            {budget <= 0 && (
                                <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    This project&apos;s budget is 0, so payment amounts cannot be calculated. Set a budget on the project first.
                                </div>
                            )}
                        </div>
                    )}

                    {milestones.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-charcoal/15 bg-white px-5 py-14 text-center">
                            <h4 className="font-heading text-base font-bold text-charcoal">No milestones yet</h4>
                            <p className="mx-auto mt-1 max-w-md text-sm text-charcoal/50">
                                Add the first stage, for example &quot;Design approval - 30%&quot;, and give it a deadline and deliverables.
                            </p>
                            <div className="mt-5 flex justify-center">
                                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAdd}>Add first milestone</ButtonEmerald>
                            </div>
                        </div>
                    ) : (
                        <div>
                            {/* Filters */}
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap gap-2">
                                    {chips.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => setFilter(c.id)}
                                            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filter === c.id ? 'bg-charcoal text-white' : 'bg-white text-charcoal/60 ring-1 ring-charcoal/10 hover:text-charcoal'}`}
                                        >
                                            {c.label} <span className={filter === c.id ? 'text-white/70' : 'text-charcoal/40'}>{counts[c.id]}</span>
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setOpenIds(openIds.size ? new Set() : new Set(visible.map(m => m._id)))}
                                    className="text-xs font-semibold text-blue-600 transition hover:text-blue-700"
                                >
                                    {openIds.size ? 'Collapse all' : 'Expand all'}
                                </button>
                            </div>

                            {visible.length === 0 ? (
                                <p className="rounded-2xl border border-charcoal/5 bg-white py-10 text-center text-sm text-charcoal/50 shadow-sm">No milestones match this filter.</p>
                            ) : (
                                <ol>
                                    {visible.map((m, i) => {
                                        const fullIndex = milestones.findIndex(x => x._id === m._id)
                                        return (
                                            <MilestoneItem
                                                key={m._id}
                                                m={m}
                                                index={fullIndex}
                                                open={openIds.has(m._id)}
                                                busy={busyId === m._id || busyId === 'reorder'}
                                                canReorder={filter === 'all'}
                                                isFirst={fullIndex === 0}
                                                isLast={i === visible.length - 1}
                                                onToggle={() => toggleOpen(m._id)}
                                                onEdit={() => { setEditing(m); setFormOpen(true) }}
                                                onDelete={() => {
                                                    if (confirm(`Delete milestone "${m.title}"?`)) run(m._id, t => deleteMilestone(t, m._id), 'Milestone deleted')
                                                }}
                                                onMove={dir => move(fullIndex, dir)}
                                                onComplete={() => run(m._id, t => updateMilestoneStatus(t, m._id, 'completed'), 'Milestone completed')}
                                                onStatus={s => run(m._id, t => updateMilestoneStatus(t, m._id, s), 'Status updated')}
                                                onPayment={s => run(m._id, t => updateMilestonePayment(t, m._id, s), 'Payment status updated')}
                                                onDeliverable={d => run(m._id, t => toggleDeliverable(t, m._id, d._id, !d.isDone))}
                                            />
                                        )
                                    })}
                                </ol>
                            )}
                        </div>
                    )}
                </>
            )}

            <MilestoneForm
                open={formOpen}
                onClose={() => setFormOpen(false)}
                projectId={projectId}
                milestone={editing}
                budget={budget}
                defaultCurrency={cur ?? 'AED'}
                remainingPercent={remainingPercent}
                onSaved={reload}
            />
        </section>
    )
}

export default ProjectMilestones
