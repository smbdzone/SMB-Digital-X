'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronUp } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { EmptyState, StatusBadge, SummaryCard } from '@/components/ui/shared'
import DeliverableItem from '@/components/deliverables/DeliverableItem'
import { errorMessage } from '@/lib/utils'
import { formatDayKey, shiftDayKey, todayKey } from '@/lib/eodDate'
import { fetchTeamDay, PLAN_STATE_LABELS, TeamDayRow } from '@/services/deliverable.services'

/** Everyone's plan and EOD for one day, for the end-of-day meeting. */
const TeamDay = () => {
    const { token } = useAuth()
    const toast = useToast()
    const [date, setDate] = useState(todayKey())
    const [rows, setRows] = useState<TeamDayRow[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState<string[]>([])
    const request = useRef(0)

    const load = useCallback(async () => {
        if (!token) return
        const id = ++request.current
        setLoading(true)
        try {
            const response = await fetchTeamDay(token, date)
            if (id === request.current) setRows(response.data?.employees ?? [])
        } catch (error) {
            if (id === request.current) toast.showError(errorMessage(error, 'Failed to load the team day'))
        } finally {
            if (id === request.current) setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, date])

    useEffect(() => { void load() }, [load])

    const planned = rows.filter(r => r.items.length > 0).length
    const waiting = rows.filter(r => r.state === 'pending').length
    const eods = rows.filter(r => r.eod).length
    const toggle = (id: string) => setOpen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

    return (
        <div className="py-4 lg:py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h4 className="font-heading text-lg font-bold sm:text-xl">Team Day</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Plans and EOD outcomes of {formatDayKey(date)}.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setDate(d => shiftDayKey(d, -1))} className="flex size-11 items-center justify-center rounded-xl border border-charcoal/10 bg-white" aria-label="Previous day"><FiChevronLeft className="size-4" /></button>
                    <input
                        type="date"
                        value={date}
                        onChange={e => e.target.value && setDate(e.target.value)}
                        className="h-11 min-w-0 flex-1 rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:flex-none"
                    />
                    <button type="button" onClick={() => setDate(d => shiftDayKey(d, 1))} className="flex size-11 items-center justify-center rounded-xl border border-charcoal/10 bg-white" aria-label="Next day"><FiChevronRight className="size-4" /></button>
                </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
                <SummaryCard title="Planned" value={`${planned}/${rows.length}`} />
                <SummaryCard title="Waiting" value={waiting} />
                <SummaryCard title="EODs" value={`${eods}/${rows.length}`} />
            </div>

            <div className="mt-5 space-y-3">
                {loading && rows.length === 0 ? (
                    <div className="rounded-xl bg-white p-8 text-center text-sm text-charcoal/40 shadow-sm">Loading...</div>
                ) : rows.length === 0 ? (
                    <div className="rounded-xl bg-white shadow-sm"><EmptyState text="No active employees." /></div>
                ) : (
                    rows.map(row => {
                        const id = row.employee._id
                        const expanded = open.includes(id)
                        const stats = row.eod?.deliverableStats
                        return (
                            <section key={id} className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                                <button type="button" onClick={() => toggle(id)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={expanded}>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-heading font-bold text-charcoal">{row.employee.name}</p>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            <StatusBadge status={row.state} variant="plan" label={PLAN_STATE_LABELS[row.state]} />
                                            <span className="text-xs text-charcoal/45">{row.items.length} item{row.items.length === 1 ? '' : 's'}</span>
                                            {stats && (
                                                <span className="text-xs text-charcoal/45">
                                                    · {stats.completed} done · {stats.inProgress} half · {stats.notStarted} not started
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        {row.eod ? (
                                            <>
                                                <p className="font-heading text-lg font-bold text-blue-600">{row.eod.overallProgress}%</p>
                                                <p className="text-[11px] text-charcoal/40">EOD</p>
                                            </>
                                        ) : (
                                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">No EOD</span>
                                        )}
                                    </div>
                                    {expanded ? <FiChevronUp className="size-4 shrink-0 text-charcoal/40" /> : <FiChevronDown className="size-4 shrink-0 text-charcoal/40" />}
                                </button>

                                {expanded && (
                                    <div className="space-y-2 border-t border-charcoal/5 p-3 sm:p-4">
                                        {row.items.length === 0 && <p className="text-sm text-charcoal/40">Nothing planned.</p>}
                                        {row.items.map(item => <DeliverableItem key={item._id} item={item} />)}
                                        {row.eod?.summary && (
                                            <div className="rounded-xl bg-charcoal/[0.03] p-3">
                                                <p className="text-xs font-semibold text-charcoal/50">EOD summary</p>
                                                <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal/75">{row.eod.summary}</p>
                                                {row.eod.blockers && <p className="mt-2 whitespace-pre-wrap text-xs text-red-600/80">Blockers: {row.eod.blockers}</p>}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )
                    })
                )}
            </div>
        </div>
    )
}

export default TeamDay
