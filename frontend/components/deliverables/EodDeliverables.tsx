'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import DeliverableItem from './DeliverableItem'
import { Deliverable, fetchEmployeeDay, fetchMyDay } from '@/services/deliverable.services'

export interface DeliverableCounts { planned: number; completed: number; inProgress: number; notStarted: number }

/** The counts line used on EOD reports, e.g. "3 completed · 1 half completed · 1 not started of 5". */
export const CountsLine = ({ stats }: { stats: DeliverableCounts }) => (
    <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 px-2 py-3">
            <p className="font-heading text-lg font-bold text-emerald-700">{stats.completed}</p>
            <p className="text-[11px] font-medium text-emerald-700/70">Completed</p>
        </div>
        <div className="rounded-xl bg-blue-50 px-2 py-3">
            <p className="font-heading text-lg font-bold text-blue-700">{stats.inProgress}</p>
            <p className="text-[11px] font-medium text-blue-700/70">Half completed</p>
        </div>
        <div className="rounded-xl bg-red-50 px-2 py-3">
            <p className="font-heading text-lg font-bold text-red-600">{stats.notStarted}</p>
            <p className="text-[11px] font-medium text-red-600/70">Not started</p>
        </div>
    </div>
)

/**
 * The deliverables of one reported day, with their outcomes.
 * Without employeeId it reads the logged-in user's own day; with it, an approver reads that employee's day.
 */
const EodDeliverables = ({ date, employeeId }: { date: string; employeeId?: string }) => {
    const { token } = useAuth()
    const [items, setItems] = useState<Deliverable[] | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (!token || !date) return
        let cancelled = false
        setItems(null)
        setFailed(false)
        const request = employeeId ? fetchEmployeeDay(token, employeeId, date) : fetchMyDay(token, date)
        request
            .then(r => { if (!cancelled) setItems(r.data?.items ?? []) })
            .catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [token, date, employeeId])

    return (
        <div>
            <h4 className="mb-3 text-sm font-semibold">Deliverables</h4>
            {failed ? (
                <p className="text-sm text-charcoal/40">Could not load the deliverables.</p>
            ) : items === null ? (
                <p className="text-sm text-charcoal/40">Loading...</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-charcoal/40">No deliverables.</p>
            ) : (
                <div className="space-y-2">
                    {items.map(item => <DeliverableItem key={item._id} item={item} hideApproval />)}
                </div>
            )}
        </div>
    )
}

export default EodDeliverables
