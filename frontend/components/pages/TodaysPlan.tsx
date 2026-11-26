'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    FiArrowDown, FiArrowUp, FiCheckSquare, FiCornerDownRight, FiEdit2, FiFileText, FiPlus, FiSend, FiTrash2,
} from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import ModalBox from '@/components/ui/ModalBox'
import ButtonEmerald from '@/components/ui/ButtonEmerald'
import { StatusBadge, EmptyState } from '@/components/ui/shared'
import DeliverableItem from '@/components/deliverables/DeliverableItem'
import DeliverableFormModal from '@/components/deliverables/DeliverableFormModal'
import { errorMessage } from '@/lib/utils'
import { formatDayKey, shiftDayKey, todayKey } from '@/lib/eodDate'
import { fetchEmployeeTasks, Task } from '@/services/task.services'
import {
    addTasksToDay, carryOverToDay, createDeliverable, Deliverable, DeliverableInput, deleteDeliverable,
    fetchLinkableProjects, fetchMyDay, MyDay, PLAN_STATE_LABELS, reorderMyDay, submitMyDay, updateDeliverable,
} from '@/services/deliverable.services'

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

// Same rules as the backend (assertOwnerCanChange): unreported, not approved; an assigned task can still be removed.
const canEdit = (item: Deliverable) => !item.reportedAt && item.approvalStatus !== 'approved'
const canRemove = (item: Deliverable) => !item.reportedAt && (item.approvalStatus !== 'approved' || item.source === 'task')

const iconButton = 'flex size-9 items-center justify-center rounded-lg text-charcoal/50 transition hover:bg-charcoal/5 hover:text-charcoal active:scale-95 disabled:pointer-events-none disabled:opacity-30'
const actionButton = 'flex h-11 items-center justify-center gap-2 rounded-xl border border-charcoal/10 bg-white px-3 text-xs font-semibold text-charcoal transition hover:bg-charcoal/[0.03] active:scale-[0.98] disabled:opacity-50 sm:text-sm'

const TodaysPlan = () => {
    const { token } = useAuth()
    const toast = useToast()
    const router = useRouter()
    const params = useSearchParams()

    const today = todayKey()
    const tomorrow = shiftDayKey(today, 1)
    const requested = params.get('date')
    const date = requested && DAY_KEY.test(requested) ? requested : today
    const plannable = date === today || date === tomorrow

    const [day, setDay] = useState<MyDay | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [projects, setProjects] = useState<{ _id: string; name: string }[]>([])

    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<Deliverable | null>(null)

    const [taskPickerOpen, setTaskPickerOpen] = useState(false)
    const [tasks, setTasks] = useState<Task[]>([])
    const [tasksLoading, setTasksLoading] = useState(false)
    const [pickedTasks, setPickedTasks] = useState<string[]>([])

    const request = useRef(0)

    const load = useCallback(async () => {
        if (!token) return
        const id = ++request.current
        setLoading(true)
        try {
            const response = await fetchMyDay(token, date)
            if (id === request.current) setDay(response.data ?? null)
        } catch (error) {
            if (id === request.current) toast.showError(errorMessage(error, 'Failed to load your plan'))
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

    const items = useMemo(() => day?.items ?? [], [day])
    const drafts = items.filter(i => i.approvalStatus === 'draft').length
    const goTo = (key: string) => router.replace(key === today ? '/deliverables' : `/deliverables?date=${key}`)

    // Runs a change, shows the server's message, reloads the day. Errors (409 = changed elsewhere) reload too.
    const run = async (work: () => Promise<{ message?: string } | void>, fallback: string) => {
        if (!token) return false
        setBusy(true)
        try {
            const response = await work()
            if (response && response.message) toast.showSuccess(response.message)
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

    const openAdd = () => { setEditing(null); setFormOpen(true) }
    const openEdit = (item: Deliverable) => { setEditing(item); setFormOpen(true) }

    const save = async (payload: DeliverableInput) => {
        if (!token) return
        const ok = await run(
            () => editing ? updateDeliverable(token, editing._id, payload) : createDeliverable(token, { ...payload, date }),
            'Failed to save the item',
        )
        if (ok) setFormOpen(false)
    }

    const remove = (item: Deliverable) => {
        if (!token || !confirm(`Remove "${item.title}" from your plan?`)) return
        void run(() => deleteDeliverable(token, item._id), 'Failed to remove the item')
    }

    const move = (index: number, by: -1 | 1) => {
        if (!token) return
        const ids = items.map(i => i._id)
        const target = index + by
        if (target < 0 || target >= ids.length) return
        ;[ids[index], ids[target]] = [ids[target], ids[index]]
        // Show the new order at once; the server answer replaces it.
        setDay(prev => prev ? { ...prev, items: ids.map(id => prev.items.find(i => i._id === id)!) } : prev)
        void run(async () => { await reorderMyDay(token, date, ids) }, 'Failed to save the order')
    }

    const openTaskPicker = async () => {
        if (!token) return
        setPickedTasks([])
        setTaskPickerOpen(true)
        setTasksLoading(true)
        try {
            const response = await fetchEmployeeTasks(token)
            setTasks(response.data ?? [])
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load your tasks'))
        } finally {
            setTasksLoading(false)
        }
    }

    const plannedTaskIds = new Set(items.map(i => i.taskId?._id).filter(Boolean))
    const openTasks = tasks.filter(t => t.status !== 'Completed' && !plannedTaskIds.has(t._id))

    const addTasks = async () => {
        if (!token || pickedTasks.length === 0) return
        const ok = await run(() => addTasksToDay(token, date, pickedTasks), 'Failed to add the tasks')
        if (ok) setTaskPickerOpen(false)
    }

    const carryOver = () => {
        if (!token) return
        void run(() => carryOverToDay(token, date), 'Failed to carry over')
    }

    const submit = () => {
        if (!token) return
        void run(() => submitMyDay(token, date), 'Failed to submit the plan')
    }

    const state = day?.state ?? 'empty'
    const stateText: Record<string, string> = {
        empty: 'Add what you will deliver, then submit it for approval.',
        draft: 'Not submitted yet. Submit when your list is ready.',
        pending: 'Submitted. Waiting for approval. You can still add items; they go to the approver too.',
        approved: 'Approved. At the end of the day, report each item in your EOD.',
    }

    return (
        <div className={`py-4 lg:py-6 ${plannable && drafts > 0 ? 'pb-24 lg:pb-6' : ''}`}>
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h4 className="font-heading text-lg font-bold sm:text-xl">{date === today ? "Today's Plan" : date === tomorrow ? "Tomorrow's Plan" : 'Plan'}</h4>
                    <p className="mt-1 text-sm text-charcoal/45">{formatDayKey(date)}</p>
                </div>
                <div className="grid grid-cols-2 rounded-xl bg-charcoal/[0.04] p-1 sm:w-64">
                    {[{ key: today, label: 'Today' }, { key: tomorrow, label: 'Tomorrow' }].map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => goTo(tab.key)}
                            className={`h-10 rounded-lg text-sm font-semibold transition ${date === tab.key ? 'bg-white text-charcoal shadow-sm' : 'text-charcoal/50'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* State */}
            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-charcoal/5 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <StatusBadge status={state} variant="plan" label={PLAN_STATE_LABELS[state]} className="mt-0.5" />
                    <p className="text-sm text-charcoal/60">{plannable ? stateText[state] : 'Past days are a record and can no longer be changed.'}</p>
                </div>
                {date === today && items.length > 0 && (
                    <Link href="/eod" className="inline-flex items-center gap-1.5 self-start rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100 sm:self-auto">
                        <FiFileText className="size-4" /> EOD report
                    </Link>
                )}
                {!plannable && (
                    <button type="button" onClick={() => goTo(today)} className="self-start text-xs font-semibold text-blue-600 sm:self-auto">Back to today</button>
                )}
            </div>

            {/* Actions */}
            {plannable && (
                <div className="mt-4 grid grid-cols-3 gap-2">
                    <button type="button" onClick={openAdd} disabled={busy} className={actionButton}><FiPlus className="size-4 shrink-0" />Add item</button>
                    <button type="button" onClick={openTaskPicker} disabled={busy} className={actionButton}><FiCheckSquare className="size-4 shrink-0" />My tasks</button>
                    <button type="button" onClick={carryOver} disabled={busy} className={actionButton} title="Copy unfinished items from your last planned day">
                        <FiCornerDownRight className="size-4 shrink-0" />Carry over
                    </button>
                </div>
            )}

            {/* Items */}
            <div className="mt-4 space-y-3">
                {loading && !day ? (
                    <div className="rounded-xl bg-white p-8 text-center text-sm text-charcoal/40 shadow-sm">Loading...</div>
                ) : items.length === 0 ? (
                    <div className="rounded-xl bg-white shadow-sm">
                        <EmptyState text={plannable ? 'Nothing planned yet. Add an item, pick from your tasks, or carry over unfinished work.' : 'Nothing was planned for this day.'} />
                    </div>
                ) : (
                    items.map((item, index) => (
                        <DeliverableItem
                            key={item._id}
                            item={item}
                            actions={plannable && (
                                <>
                                    <button type="button" className={iconButton} onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up"><FiArrowUp className="size-4" /></button>
                                    <button type="button" className={iconButton} onClick={() => move(index, 1)} disabled={busy || index === items.length - 1} aria-label="Move down"><FiArrowDown className="size-4" /></button>
                                    {canEdit(item) && (
                                        <button type="button" className={`${iconButton} text-blue-600`} onClick={() => openEdit(item)} disabled={busy} aria-label="Edit"><FiEdit2 className="size-4" /></button>
                                    )}
                                    {canRemove(item) && (
                                        <button type="button" className={`${iconButton} text-red-500`} onClick={() => remove(item)} disabled={busy} aria-label="Remove"><FiTrash2 className="size-4" /></button>
                                    )}
                                </>
                            )}
                        />
                    ))
                )}
            </div>

            {/* Submit: a bar at the bottom of the screen on phones */}
            {plannable && drafts > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-charcoal/5 bg-white/95 p-3 backdrop-blur lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
                    <ButtonEmerald onClick={submit} loading={busy} icon={<FiSend className="size-4" />} className="w-full lg:w-auto">
                        Submit {drafts} item{drafts === 1 ? '' : 's'} for approval
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
                description={editing ? undefined : `For ${formatDayKey(date)}`}
            />

            <ModalBox
                open={taskPickerOpen}
                onClose={() => setTaskPickerOpen(false)}
                size="lg"
                title="Add from my tasks"
                description="Assigned tasks are approved already."
                footer={
                    <>
                        <button type="button" onClick={() => setTaskPickerOpen(false)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                        <ButtonEmerald onClick={addTasks} loading={busy} disabled={pickedTasks.length === 0} icon={<FiPlus className="size-4" />}>
                            Add {pickedTasks.length || ''}
                        </ButtonEmerald>
                    </>
                }
            >
                {tasksLoading ? (
                    <p className="py-6 text-center text-sm text-charcoal/40">Loading tasks...</p>
                ) : openTasks.length === 0 ? (
                    <p className="py-6 text-center text-sm text-charcoal/40">No open tasks to add.</p>
                ) : (
                    <div className="space-y-2">
                        {openTasks.map(task => {
                            const checked = pickedTasks.includes(task._id)
                            const project = typeof task.projectId === 'object' ? task.projectId?.name : ''
                            return (
                                <label key={task._id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${checked ? 'border-blue-300 bg-blue-50/50' : 'border-charcoal/10'}`}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => setPickedTasks(prev => checked ? prev.filter(id => id !== task._id) : [...prev, task._id])}
                                        className="mt-0.5 size-5 shrink-0 accent-blue-600"
                                    />
                                    <span className="min-w-0">
                                        <span className="block break-words text-sm font-semibold text-charcoal">{task.title}</span>
                                        <span className="mt-0.5 block text-xs text-charcoal/50">
                                            {[project, task.status, `${task.progress ?? 0}%`].filter(Boolean).join(' · ')}
                                        </span>
                                    </span>
                                </label>
                            )
                        })}
                    </div>
                )}
            </ModalBox>
        </div>
    )
}

export default TodaysPlan
