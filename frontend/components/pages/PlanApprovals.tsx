'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FiCheck, FiEdit2, FiPlus, FiRefreshCw, FiTrash2 } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import ButtonEmerald from '@/components/ui/ButtonEmerald'
import { EmptyState } from '@/components/ui/shared'
import DeliverableItem from '@/components/deliverables/DeliverableItem'
import DeliverableFormModal from '@/components/deliverables/DeliverableFormModal'
import { errorMessage } from '@/lib/utils'
import { formatDayKey, shiftDayKey, todayKey } from '@/lib/eodDate'
import {
    approvePlans, createDeliverable, Deliverable, DeliverableInput, deleteDeliverable, fetchApprovalQueue,
    fetchLinkableProjects, QueuePlan, updateDeliverable,
} from '@/services/deliverable.services'

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const planKey = (p: { employee: { _id: string }; date: string }) => `${p.employee._id}|${p.date}`

const iconButton = 'flex size-9 items-center justify-center rounded-lg transition hover:bg-charcoal/5 active:scale-95 disabled:pointer-events-none disabled:opacity-30'

/** Plans waiting for approval. The API leaves out the approver's own plan (nobody approves their own). */
const PlanApprovals = () => {
    const { token } = useAuth()
    const toast = useToast()
    const router = useRouter()
    const params = useSearchParams()

    const requested = params.get('date')
    const date = requested && DAY_KEY.test(requested) ? requested : ''

    const [plans, setPlans] = useState<QueuePlan[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [selected, setSelected] = useState<string[]>([])
    const [projects, setProjects] = useState<{ _id: string; name: string }[]>([])

    // Approver edit / add
    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<Deliverable | null>(null)
    const [addingTo, setAddingTo] = useState<QueuePlan | null>(null)

    const request = useRef(0)

    const load = useCallback(async () => {
        if (!token) return
        const id = ++request.current
        setLoading(true)
        try {
            const response = await fetchApprovalQueue(token, date ? { date } : {})
            if (id !== request.current) return
            const data = response.data ?? []
            setPlans(data)
            // keep only selections that are still in the queue
            setSelected(prev => prev.filter(k => data.some(p => planKey(p) === k)))
        } catch (error) {
            if (id === request.current) toast.showError(errorMessage(error, 'Failed to load the approval queue'))
        } finally {
            if (id === request.current) setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, date])

    useEffect(() => { void load() }, [load])

    useEffect(() => {
        if (!token) return
        fetchLinkableProjects(token).then(r => setProjects(r.data ?? [])).catch(() => setProjects([]))
    }, [token])

    const run = async (work: () => Promise<{ message?: string }>, fallback: string) => {
        setBusy(true)
        try {
            const response = await work()
            if (response.message) toast.showSuccess(response.message)
            await load()
            return true
        } catch (error) {
            toast.showError(errorMessage(error, fallback))
            await load()
            return false
        } finally {
            setBusy(false)
        }
    }

    const approve = (list: QueuePlan[]) => {
        if (!token || list.length === 0) return
        void run(() => approvePlans(token, list.map(p => ({ employeeId: p.employee._id, date: p.date }))), 'Failed to approve')
    }

    const toggle = (plan: QueuePlan) => {
        const key = planKey(plan)
        setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    }
    const allSelected = plans.length > 0 && selected.length === plans.length

    const openEdit = (item: Deliverable) => { setAddingTo(null); setEditing(item); setFormOpen(true) }
    const openAdd = (plan: QueuePlan) => { setEditing(null); setAddingTo(plan); setFormOpen(true) }

    const save = async (payload: DeliverableInput) => {
        if (!token) return
        const ok = editing
            ? await run(() => updateDeliverable(token, editing._id, payload), 'Failed to save the item')
            : addingTo
                ? await run(() => createDeliverable(token, { ...payload, employeeId: addingTo.employee._id, date: addingTo.date }), 'Failed to add the item')
                : false
        if (ok) setFormOpen(false)
    }

    const remove = (item: Deliverable) => {
        if (!token || !confirm(`Remove "${item.title}" from this plan? The employee is notified.`)) return
        void run(() => deleteDeliverable(token, item._id), 'Failed to remove the item')
    }

    const today = todayKey()
    const canAddTo = (plan: QueuePlan) => plan.date === today || plan.date === shiftDayKey(today, 1)

    return (
        <div className={`py-4 lg:py-6 ${selected.length ? 'pb-24 lg:pb-6' : ''}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h4 className="font-heading text-lg font-bold sm:text-xl">Plan Approvals</h4>
                    <p className="mt-1 text-sm text-charcoal/45">
                        {date ? `Plans for ${formatDayKey(date)}` : 'Every plan waiting for approval'}
                        {date && <button type="button" onClick={() => router.replace('/deliverables/approvals')} className="ml-2 font-semibold text-blue-600">Show all</button>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void load()} disabled={loading || busy} className="flex h-11 items-center gap-2 rounded-xl border border-charcoal/10 bg-white px-3 text-sm font-semibold disabled:opacity-50">
                        <FiRefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    {plans.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setSelected(allSelected ? [] : plans.map(planKey))}
                            className="h-11 rounded-xl border border-charcoal/10 bg-white px-3 text-sm font-semibold"
                        >
                            {allSelected ? 'Clear' : 'Select all'}
                        </button>
                    )}
                </div>
            </div>

            <div className="mt-5 space-y-4">
                {loading && plans.length === 0 ? (
                    <div className="rounded-xl bg-white p-8 text-center text-sm text-charcoal/40 shadow-sm">Loading...</div>
                ) : plans.length === 0 ? (
                    <div className="rounded-xl bg-white shadow-sm"><EmptyState text="No plans waiting for approval." /></div>
                ) : (
                    plans.map(plan => {
                        const key = planKey(plan)
                        const checked = selected.includes(key)
                        return (
                            <section key={key} className={`rounded-2xl border bg-charcoal/[0.015] p-3 sm:p-4 ${checked ? 'border-blue-300' : 'border-charcoal/5'}`}>
                                <div className="flex items-start gap-3">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(plan)}
                                        className="mt-1 size-5 shrink-0 accent-blue-600"
                                        aria-label={`Select ${plan.employee.name}'s plan`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-heading font-bold text-charcoal">{plan.employee.name}</p>
                                        <p className="text-xs text-charcoal/45">
                                            {formatDayKey(plan.date)} · {plan.pending} waiting{plan.employee.position ? ` · ${plan.employee.position}` : ''}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => approve([plan])}
                                        disabled={busy}
                                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-sm font-semibold text-white transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50"
                                    >
                                        <FiCheck className="size-4" /> Approve
                                    </button>
                                </div>

                                <div className="mt-3 space-y-2">
                                    {plan.items.map(item => (
                                        <DeliverableItem
                                            key={item._id}
                                            item={item}
                                            actions={!item.reportedAt && (
                                                <>
                                                    <button type="button" className={`${iconButton} text-blue-600`} onClick={() => openEdit(item)} disabled={busy} aria-label="Edit"><FiEdit2 className="size-4" /></button>
                                                    <button type="button" className={`${iconButton} text-red-500`} onClick={() => remove(item)} disabled={busy} aria-label="Remove"><FiTrash2 className="size-4" /></button>
                                                </>
                                            )}
                                        />
                                    ))}
                                </div>

                                {canAddTo(plan) && (
                                    <button type="button" onClick={() => openAdd(plan)} disabled={busy} className="mt-3 flex h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50">
                                        <FiPlus className="size-4" /> Add an item
                                    </button>
                                )}
                            </section>
                        )
                    })
                )}
            </div>

            {selected.length > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-charcoal/5 bg-white/95 p-3 backdrop-blur lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
                    <ButtonEmerald
                        onClick={() => approve(plans.filter(p => selected.includes(planKey(p))))}
                        loading={busy}
                        icon={<FiCheck className="size-4" />}
                        className="w-full lg:w-auto"
                    >
                        Approve {selected.length} plan{selected.length === 1 ? '' : 's'}
                    </ButtonEmerald>
                </div>
            )}

            <DeliverableFormModal
                open={formOpen}
                onClose={() => setFormOpen(false)}
                item={editing}
                projects={projects}
                saving={busy}
                onSave={save}
                title={editing ? 'Edit item' : `Add to ${addingTo?.employee.name ?? ''}'s plan`}
                description={editing ? 'The employee sees what you changed.' : 'Items you add are approved at once.'}
            />
        </div>
    )
}

export default PlanApprovals
