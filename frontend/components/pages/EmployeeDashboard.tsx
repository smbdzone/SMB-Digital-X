'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { FiArrowRight, FiCheckSquare, FiFileText, FiList } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useDeliverableAccess } from '@/hooks/useDeliverableAccess'
import { StatusBadge } from '@/components/ui/shared'
import { RateWithCarry } from '@/components/deliverables/StatsBlocks'
import { formatDayKey, todayKey } from '@/lib/eodDate'
import {
    DeliverableStats, fetchApprovalQueue, fetchMyDay, fetchMyStats, MyDay, PLAN_STATE_LABELS,
} from '@/services/deliverable.services'

/**
 * Employee home. Uses only employee endpoints (/deliverables/my, /deliverables/stats/me, and the
 * approval queue for approvers). /api/dashboard is admin-only and is never called from here.
 */
const EmployeeDashboard = () => {
    const { token, user } = useAuth()
    const { canApprove } = useDeliverableAccess()
    const [day, setDay] = useState<MyDay | null>(null)
    const [stats, setStats] = useState<DeliverableStats | null>(null)
    const [waiting, setWaiting] = useState<number | null>(null)

    useEffect(() => {
        if (!token) return
        // Each card loads on its own; one failing does not hide the others.
        fetchMyDay(token).then(r => setDay(r.data ?? null)).catch(() => setDay(null))
        fetchMyStats(token).then(r => setStats(r.data?.stats ?? null)).catch(() => setStats(null))
    }, [token])

    useEffect(() => {
        if (!token || !canApprove) return
        fetchApprovalQueue(token).then(r => setWaiting((r.data ?? []).length)).catch(() => setWaiting(null))
    }, [token, canApprove])

    const state = day?.state ?? 'empty'
    const drafts = day?.items.filter(i => i.approvalStatus === 'draft').length ?? 0

    return (
        <div className="space-y-5 py-4 lg:py-6">
            <div>
                <h1 className="font-heading text-xl font-bold text-charcoal sm:text-2xl">
                    Welcome back, <span className="text-blue-600">{user?.name}</span>
                </h1>
                <p className="mt-1 text-sm text-charcoal/50">{formatDayKey(todayKey())}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* Today's plan */}
                <Link href="/deliverables" className="group rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm text-charcoal/50">Today's plan</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <StatusBadge status={state} variant="plan" label={PLAN_STATE_LABELS[state]} />
                                {day && day.items.length > 0 && <span className="text-xs text-charcoal/45">{day.items.length} item{day.items.length === 1 ? '' : 's'}</span>}
                            </div>
                        </div>
                        <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-500 group-hover:text-white"><FiList className="size-5" /></div>
                    </div>
                    <p className="mt-4 flex items-center justify-between text-xs text-charcoal/45">
                        {state === 'empty' ? 'Plan your day' : drafts > 0 ? `${drafts} not submitted yet` : 'Open your plan'}
                        <FiArrowRight className="size-4 text-charcoal/20 transition group-hover:translate-x-1 group-hover:text-blue-500" />
                    </p>
                </Link>

                {/* This month */}
                <Link href="/deliverables/performance" className="group rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                    <p className="text-sm text-charcoal/50">Completion this month</p>
                    <div className="mt-2">
                        {stats ? <RateWithCarry stats={stats} /> : <span className="font-heading text-3xl font-bold text-charcoal/30">-</span>}
                    </div>
                    <p className="mt-4 flex items-center justify-between text-xs text-charcoal/45">
                        {stats ? `${stats.completed} of ${stats.planned} completed · ${stats.inProgress} half completed` : 'No reported deliverables yet'}
                        <FiArrowRight className="size-4 text-charcoal/20 transition group-hover:translate-x-1 group-hover:text-blue-500" />
                    </p>
                </Link>

                {canApprove ? (
                    <Link href="/deliverables/approvals" className="group rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm text-charcoal/50">Waiting for your approval</p>
                                <p className="mt-2 font-heading text-3xl font-bold text-charcoal">{waiting ?? '-'}</p>
                            </div>
                            <div className="flex size-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition group-hover:bg-amber-500 group-hover:text-white"><FiCheckSquare className="size-5" /></div>
                        </div>
                        <p className="mt-4 flex items-center justify-between text-xs text-charcoal/45">
                            Plans to approve
                            <FiArrowRight className="size-4 text-charcoal/20 transition group-hover:translate-x-1 group-hover:text-blue-500" />
                        </p>
                    </Link>
                ) : (
                    <Link href="/eod" className="group rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm text-charcoal/50">End of day</p>
                                <p className="mt-2 text-sm font-semibold text-charcoal">Report today's outcomes</p>
                            </div>
                            <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-500 group-hover:text-white"><FiFileText className="size-5" /></div>
                        </div>
                        <p className="mt-4 flex items-center justify-between text-xs text-charcoal/45">
                            EOD reports
                            <FiArrowRight className="size-4 text-charcoal/20 transition group-hover:translate-x-1 group-hover:text-blue-500" />
                        </p>
                    </Link>
                )}
            </div>
        </div>
    )
}

export default EmployeeDashboard
