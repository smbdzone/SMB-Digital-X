'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useDeliverableAccess } from '@/hooks/useDeliverableAccess'
import { EmptyState } from '@/components/ui/shared'
import { CARRY_OVER_HELP, InfoTip, RateWithCarry, StatsPanel } from '@/components/deliverables/StatsBlocks'
import { errorMessage } from '@/lib/utils'
import { formatDayKey, shiftDayKey, todayKey } from '@/lib/eodDate'
import {
    DeliverableStats, fetchMyStats, fetchTeamStats, PlanEmployee,
} from '@/services/deliverable.services'

type Preset = 'month' | '30' | '7' | 'custom'

const rangeFor = (preset: Exclude<Preset, 'custom'>) => {
    const to = todayKey()
    if (preset === 'month') return { from: `${to.slice(0, 8)}01`, to }
    return { from: shiftDayKey(to, -(Number(preset) - 1)), to }
}

const dateInput = 'h-11 w-full rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10'

/**
 * Employees see their own numbers. Approvers (admin, flagged employees) also see the whole team.
 * The admin does not plan, so the admin only sees the team.
 */
const DeliverablePerformance = () => {
    const { token, role } = useAuth()
    const toast = useToast()
    const { canApprove } = useDeliverableAccess()
    const isAdmin = role === 'admin'

    const [preset, setPreset] = useState<Preset>('month')
    const [range, setRange] = useState(rangeFor('month'))
    const [mine, setMine] = useState<DeliverableStats | null>(null)
    const [team, setTeam] = useState<{ employee: PlanEmployee; stats: DeliverableStats }[]>([])
    const [loading, setLoading] = useState(true)
    const request = useRef(0)

    const load = useCallback(async () => {
        if (!token || !range.from || !range.to || range.from > range.to) return
        const id = ++request.current
        setLoading(true)
        try {
            const [own, others] = await Promise.all([
                isAdmin ? Promise.resolve(null) : fetchMyStats(token, range),
                canApprove ? fetchTeamStats(token, range) : Promise.resolve(null),
            ])
            if (id !== request.current) return
            setMine(own?.data?.stats ?? null)
            setTeam(others?.data?.employees ?? [])
        } catch (error) {
            if (id === request.current) toast.showError(errorMessage(error, 'Failed to load performance'))
        } finally {
            if (id === request.current) setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, range.from, range.to, isAdmin, canApprove])

    useEffect(() => { void load() }, [load])

    const choose = (p: Preset) => {
        setPreset(p)
        if (p !== 'custom') setRange(rangeFor(p))
    }

    const presets: { key: Preset; label: string }[] = [
        { key: 'month', label: 'This month' },
        { key: '30', label: '30 days' },
        { key: '7', label: '7 days' },
        { key: 'custom', label: 'Custom' },
    ]

    return (
        <div className="space-y-5 py-4 lg:py-6">
            <div>
                <h4 className="font-heading text-lg font-bold sm:text-xl">{isAdmin ? 'Performance' : 'My Performance'}</h4>
                <p className="mt-1 text-sm text-charcoal/45">{formatDayKey(range.from)} – {formatDayKey(range.to)}. Today counts once it is reported.</p>
            </div>

            <div className="space-y-3">
                <div className="grid grid-cols-4 rounded-xl bg-charcoal/[0.04] p-1 sm:w-96">
                    {presets.map(p => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => choose(p.key)}
                            className={`h-10 rounded-lg text-xs font-semibold transition sm:text-sm ${preset === p.key ? 'bg-white text-charcoal shadow-sm' : 'text-charcoal/50'}`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                {preset === 'custom' && (
                    <div className="grid grid-cols-2 gap-2 sm:w-96">
                        <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} className={dateInput} aria-label="From" />
                        <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} className={dateInput} aria-label="To" />
                    </div>
                )}
            </div>

            {!isAdmin && (
                <section className="rounded-2xl border border-charcoal/5 bg-white p-4 shadow-sm sm:p-6">
                    {loading && !mine ? (
                        <p className="py-6 text-center text-sm text-charcoal/40">Loading...</p>
                    ) : mine && mine.planned > 0 ? (
                        <StatsPanel stats={mine} />
                    ) : (
                        <EmptyState text="No reported deliverables in this period yet." />
                    )}
                </section>
            )}

            {canApprove && (
                <section className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                    <div className="border-b border-charcoal/5 px-4 py-4 sm:px-6">
                        <h2 className="font-heading text-sm font-bold sm:text-base">Team</h2>
                    </div>

                    {loading && team.length === 0 ? (
                        <p className="py-8 text-center text-sm text-charcoal/40">Loading...</p>
                    ) : team.length === 0 ? (
                        <EmptyState text="No active employees." />
                    ) : (
                        <>
                            {/* Phones: one card per person */}
                            <div className="divide-y divide-charcoal/5 md:hidden">
                                {team.map(({ employee, stats }) => (
                                    <div key={employee._id} className="px-4 py-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-charcoal">{employee.name}</p>
                                                {employee.position && <p className="text-xs text-charcoal/45">{employee.position}</p>}
                                            </div>
                                            <RateWithCarry stats={stats} size="sm" />
                                        </div>
                                        <p className="mt-2 text-xs text-charcoal/55">
                                            {stats.planned} planned · {stats.completed} completed · {stats.inProgress} half completed · {stats.notStarted} not started
                                        </p>
                                        <p className="mt-0.5 text-xs text-charcoal/45">
                                            Weighted {stats.weightedRate ?? '-'}{stats.weightedRate === null ? '' : '%'} · {stats.daysWithEod}/{stats.daysWithPlan} days with EOD
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {/* Wider screens: a table */}
                            <div className="hidden overflow-x-auto md:block">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            {['Employee', 'Completion', 'Weighted', 'Planned', 'Completed', 'Half completed', 'Not started', 'Hours (est / actual)', 'Days with EOD'].map(h => (
                                                <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                                    {h}
                                                    {h === 'Completion' && <InfoTip text={CARRY_OVER_HELP} label="How carried items are counted" />}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 bg-white">
                                        {team.map(({ employee, stats }) => (
                                            <tr key={employee._id}>
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <p className="text-sm font-medium text-gray-900">{employee.name}</p>
                                                    {employee.position && <p className="text-xs text-gray-400">{employee.position}</p>}
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3"><RateWithCarry stats={stats} size="sm" /></td>
                                                <td className="px-4 py-3 text-sm text-gray-600">{stats.weightedRate === null ? '-' : `${stats.weightedRate}%`}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600">{stats.planned}</td>
                                                <td className="px-4 py-3 text-sm text-emerald-700">{stats.completed}</td>
                                                <td className="px-4 py-3 text-sm text-blue-700">{stats.inProgress}</td>
                                                <td className="px-4 py-3 text-sm text-red-600">{stats.notStarted}</td>
                                                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{stats.estimatedHours} / {stats.actualHours}</td>
                                                <td className="px-4 py-3 text-sm text-gray-600">{stats.daysWithEod}/{stats.daysWithPlan}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            )}
        </div>
    )
}

export default DeliverablePerformance
