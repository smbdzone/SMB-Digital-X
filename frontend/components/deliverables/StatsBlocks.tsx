'use client'

import React, { useEffect, useRef, useState } from 'react'
import { FiInfo } from 'react-icons/fi'
import { DeliverableStats } from '@/services/deliverable.services'

export const CARRY_OVER_HELP =
    'Carried items count on each day they were planned. A task carried from Monday to Tuesday is counted on Monday (as it ended that day) and again on Tuesday.'

export const RATE_HELP =
    'Completion rate = completed / planned. Weighted rate also counts each Half completed item as half, the same way as the EOD progress.'

/** A small "i" that explains a number. Opens on tap (phones) and on hover (desktop). */
export const InfoTip = ({ text, label = 'More information' }: { text: string; label?: string }) => {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        if (!open) return
        const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [open])

    return (
        <span ref={ref} className="group relative inline-flex align-middle">
            <button
                type="button"
                // May sit inside a link card: open the tip without following the link
                onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v) }}
                aria-label={label}
                aria-expanded={open}
                className="flex size-6 items-center justify-center rounded-full text-charcoal/35 transition hover:text-charcoal/70"
            >
                <FiInfo className="size-3.5" />
            </button>
            <span
                role="tooltip"
                className={`absolute bottom-full left-1/2 z-20 mb-1 w-56 -translate-x-1/2 rounded-lg bg-charcoal px-3 py-2 text-left text-[11px] font-normal normal-case leading-4 tracking-normal text-white shadow-lg ${open ? 'block' : 'hidden group-hover:block'}`}
            >
                {text}
            </span>
        </span>
    )
}

const rate = (value: number | null) => (value === null ? '-' : `${value}%`)

/** Completion rate with the carry-over count right next to it. */
export const RateWithCarry = ({ stats, size = 'lg' }: { stats: DeliverableStats; size?: 'lg' | 'sm' }) => (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`font-heading font-bold text-charcoal ${size === 'lg' ? 'text-3xl' : 'text-base'}`}>{rate(stats.completionRate)}</span>
        <span className={`inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ${size === 'lg' ? 'text-xs' : 'text-[11px]'}`}>
            {stats.carriedOver} carried over
            <InfoTip text={CARRY_OVER_HELP} label="How carried items are counted" />
        </span>
    </div>
)

/** The full stats block for one person. */
export const StatsPanel = ({ stats }: { stats: DeliverableStats }) => (
    <div className="space-y-4">
        <div>
            <p className="flex items-center gap-1 text-xs font-medium text-charcoal/45">
                Completion rate <InfoTip text={RATE_HELP} label="How the rates are calculated" />
            </p>
            <div className="mt-1"><RateWithCarry stats={stats} /></div>
            <p className="mt-1 text-xs text-charcoal/45">Weighted (Half completed = ½): {rate(stats.weightedRate)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Planned" value={stats.planned} />
            <Figure label="Completed" value={stats.completed} tone="text-emerald-700" />
            <Figure label="Half completed" value={stats.inProgress} tone="text-blue-700" />
            <Figure label="Not started" value={stats.notStarted} tone="text-red-600" />
            <Figure label="Est. hours" value={stats.estimatedHours} />
            <Figure label="Actual hours" value={stats.actualHours} />
            <Figure label="Days planned" value={stats.daysWithPlan} />
            <Figure label="Days with EOD" value={stats.daysWithEod} />
        </div>
    </div>
)

const Figure = ({ label, value, tone = 'text-charcoal' }: { label: string; value: number; tone?: string }) => (
    <div className="rounded-xl bg-charcoal/[0.03] px-3 py-2.5">
        <p className={`font-heading text-lg font-bold ${tone}`}>{value}</p>
        <p className="text-[11px] text-charcoal/45">{label}</p>
    </div>
)
