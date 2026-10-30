'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { FiEdit, FiPlus, FiTrash2 } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    deleteHistoryEntry,
    fetchEmployeeHistory,
    fetchMyHistory,
    historyTypeLabel,
    type HistoryEntry,
    type HistoryOrder,
    type HistoryType,
    type TimelineResponse,
} from '@/services/employeeHistory.services'
import { formatDay } from '@/lib/formatDay'
import { errorMessage, formatCurrency } from '@/lib/utils'
import { EmptyState, StatusBadge, SummaryCard } from '@/components/ui/shared'
import ButtonEmerald from '../ui/ButtonEmerald'
import HistoryEntryForm from './HistoryEntryForm'

interface Props {
    employeeId?: string  // whose history to show (admin view)
    mine?: boolean       // show the logged-in user's own history
    canEdit?: boolean    // admin only: add / edit / delete
}

const typeStyles: Record<HistoryType, { badge: string; dot: string }> = {
    joined: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    rejoined: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    probation_completed: { badge: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
    promotion: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    salary_increase: { badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    demotion: { badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
    salary_decrease: { badge: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
    position_change: { badge: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
    transfer: { badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
    resignation: { badge: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
    termination: { badge: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
    other: { badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
}

const money = (value?: number | null, currency?: string) =>
    value === undefined || value === null ? '-' : formatCurrency(value, currency)

const EmployeeHistoryTimeline = ({ employeeId, mine = false, canEdit = false }: Props) => {
    const { token } = useAuth()
    const toast = useToast()

    const [timeline, setTimeline] = useState<TimelineResponse | null>(null)
    const [order, setOrder] = useState<HistoryOrder>('desc')
    const [loading, setLoading] = useState(true)
    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<HistoryEntry | null>(null)
    const [deletingId, setDeletingId] = useState('')

    const load = useCallback(async () => {
        if (!token || (!mine && !employeeId)) return
        setLoading(true)
        try {
            const response = mine
                ? await fetchMyHistory(token, order)
                : await fetchEmployeeHistory(token, employeeId as string, order)
            setTimeline(response)
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load employee history'))
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, mine, employeeId, order])

    useEffect(() => {
        load()
    }, [load])

    const openAdd = () => {
        setEditing(null)
        setFormOpen(true)
    }

    const openEdit = (entry: HistoryEntry) => {
        setEditing(entry)
        setFormOpen(true)
    }

    const handleDelete = async (entry: HistoryEntry) => {
        if (!token) return
        if (!confirm('Delete this history entry? The employee\'s current position and salary will not change.')) return
        setDeletingId(entry._id)
        try {
            await deleteHistoryEntry(token, entry._id)
            toast.showSuccess('History entry deleted')
            load()
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to delete history entry'))
        } finally {
            setDeletingId('')
        }
    }

    if (loading && !timeline) {
        return <p className="py-10 text-center text-sm text-charcoal/50">Loading history...</p>
    }
    if (!timeline) {
        return <p className="py-10 text-center text-sm text-red-500">History could not be loaded.</p>
    }

    const { employee, summary, data: entries } = timeline

    return (
        <div className="space-y-6">
            {/* Employee card */}
            <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-50 font-heading text-lg font-bold text-blue-600">
                            {employee.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-heading text-lg font-bold text-charcoal">{employee.name}</h3>
                                <StatusBadge status={employee.status ?? 'active'} variant="employee" />
                            </div>
                            <p className="truncate text-sm text-charcoal/50">{employee.email}</p>
                        </div>
                    </div>
                    <dl className="grid grid-cols-3 gap-6 text-sm">
                        <div>
                            <dt className="text-xs text-charcoal/40">Current position</dt>
                            <dd className="mt-1 font-semibold text-charcoal">{employee.position || '-'}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-charcoal/40">Current salary</dt>
                            <dd className="mt-1 font-semibold text-charcoal">
                                {employee.salary?.amount !== undefined ? formatCurrency(employee.salary.amount, employee.salary.currency) : '-'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs text-charcoal/40">Joined</dt>
                            <dd className="mt-1 font-semibold text-charcoal">{formatDay(employee.joinedAt)}</dd>
                        </div>
                    </dl>
                </div>
            </div>

            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard title="Total events" value={summary.totalEvents} />
                <SummaryCard title="Promotions" value={summary.promotions} />
                <SummaryCard title="Salary changes" value={summary.salaryChanges} />
                <SummaryCard
                    title="Last event"
                    value={formatDay(summary.lastEventDate)}
                    subtitle={summary.firstEventDate ? `First event ${formatDay(summary.firstEventDate)}` : undefined}
                />
            </div>

            {/* Timeline */}
            <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-heading text-base font-bold text-charcoal">History</h4>
                    <div className="flex items-center gap-3">
                        <select
                            value={order}
                            onChange={e => setOrder(e.target.value as HistoryOrder)}
                            aria-label="Sort order"
                            className="h-12 rounded-xl border border-charcoal/10 bg-white px-3 text-sm text-charcoal outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        >
                            <option value="desc">Newest first</option>
                            <option value="asc">Oldest first</option>
                        </select>
                        {canEdit && (
                            <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAdd}>Add entry</ButtonEmerald>
                        )}
                    </div>
                </div>

                {entries.length === 0 ? (
                    <EmptyState text={canEdit ? 'No history recorded yet. Add the first entry.' : 'No history has been recorded for you yet.'} />
                ) : (
                    <ol className="relative ml-2 border-l border-charcoal/10">
                        {entries.map(entry => {
                            const style = typeStyles[entry.type] ?? typeStyles.other
                            const hasPosition = !!(entry.fromPosition || entry.toPosition)
                            const hasSalary = entry.fromSalary !== undefined || entry.toSalary !== undefined
                            const addedBy = typeof entry.addedBy === 'object' ? entry.addedBy?.name : undefined

                            return (
                                <li key={entry._id} className="relative pb-7 pl-6 last:pb-0">
                                    <span className={`absolute -left-[7px] top-1.5 size-3.5 rounded-full ring-4 ring-white ${style.dot}`} />
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}>{historyTypeLabel(entry.type)}</span>
                                                <span className="text-xs text-charcoal/45">{formatDay(entry.effectiveDate)}</span>
                                            </div>
                                            <h5 className="mt-2 font-heading text-sm font-bold text-charcoal">{entry.title}</h5>
                                            {entry.description && <p className="mt-1 text-sm leading-6 text-charcoal/60">{entry.description}</p>}

                                            {(hasPosition || hasSalary) && (
                                                <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-charcoal/[0.03] px-4 py-3 text-sm">
                                                    {hasPosition && (
                                                        <div>
                                                            <p className="text-xs text-charcoal/40">Position</p>
                                                            <p className="mt-0.5 font-medium text-charcoal">{entry.fromPosition || '-'} &rarr; {entry.toPosition || '-'}</p>
                                                        </div>
                                                    )}
                                                    {hasSalary && (
                                                        <div>
                                                            <p className="text-xs text-charcoal/40">Salary</p>
                                                            <p className="mt-0.5 font-medium text-charcoal">{money(entry.fromSalary, entry.currency)} &rarr; {money(entry.toSalary, entry.currency)}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {addedBy && <p className="mt-2 text-xs text-charcoal/40">Added by {addedBy}</p>}
                                        </div>

                                        {canEdit && (
                                            <div className="flex shrink-0 items-center gap-3">
                                                <button onClick={() => openEdit(entry)} className="text-blue-600 transition hover:text-blue-800" title="Edit"><FiEdit className="size-4" /></button>
                                                <button onClick={() => handleDelete(entry)} disabled={deletingId === entry._id} className="text-red-500 transition hover:text-red-700 disabled:opacity-50" title="Delete"><FiTrash2 className="size-4" /></button>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            )
                        })}
                    </ol>
                )}
            </div>

            {canEdit && employeeId && (
                <HistoryEntryForm
                    open={formOpen}
                    onClose={() => setFormOpen(false)}
                    employeeId={employeeId}
                    entry={editing}
                    onSaved={load}
                />
            )}
        </div>
    )
}

export default EmployeeHistoryTimeline
