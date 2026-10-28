'use client'

import React, { useEffect, useState } from 'react'
import { FiCalendar, FiEdit, FiFlag, FiClock, FiFileText, FiFolder } from 'react-icons/fi'
import { FaEye } from 'react-icons/fa'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchEmployeeTasks, updateTask, Task } from '@/services/task.services'
import Input from '../ui/Input'
import ModalBox from '../ui/ModalBox'
import ButtonEmerald from '../ui/ButtonEmerald'
import { ProjectStatus } from '@/components/ui/shared'

const EmployeeTasks = () => {
    const { token } = useAuth()
    const toast = useToast()

    const [tasks, setTasks] = useState<Task[]>([])
    const [loading, setLoading] = useState(false)
    const [editTask, setEditTask] = useState<Task | null>(null)
    const [progress, setProgress] = useState('')
    const [status, setStatus] = useState('')
    const [notes, setNotes] = useState('')
    const [viewModel, setViewModel] = useState(false)
    const [viewTask, setViewTask] = useState<any>({})

    useEffect(() => {
        if (token) loadTasks()
    }, [token])

    const loadTasks = async () => {
        if (!token) return
        setLoading(true)
        try {
            const response = await fetchEmployeeTasks(token)
            if (response.success) {
                setTasks(response.data ?? [])
            } else {
                toast.showError(response.message || 'Failed to load tasks')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to load tasks')
        } finally {
            setLoading(false)
        }
    }

    const openEdit = (task: Task) => {
        setEditTask(task)
        setProgress(String(task.progress ?? 0))
        setStatus(task.status)
        setNotes(task.notes ?? '')
    }

    const closeEdit = () => {
        setEditTask(null)
        setProgress('')
        setStatus('')
        setNotes('')
    }

    const openView = (task: Task) => {
        setViewModel(true)
        setViewTask(task)
    }

    const handleUpdate = async () => {
        if (!token || !editTask) return
        const progressValue = Number(progress)
        if (progressValue < 0 || progressValue > 100) {
            toast.showError('Progress must be between 0 and 100')
            return
        }
        setLoading(true)
        try {
            const response = await updateTask(editTask._id, { progress: progressValue, status: progressValue === 100 ? 'Completed' : status, notes }, token)
            if (response.success) {
                toast.showSuccess('Task updated successfully')
                closeEdit()
                loadTasks()
            } else {
                toast.showError(response.message || 'Failed to update task')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to update task')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div className="mb-6">
                <h3 className="font-heading text-xl font-bold">My Tasks</h3>
                <p className="mt-1 text-sm text-charcoal/45">View and update your assigned tasks.</p>
            </div>

            {loading && !tasks.length ? (
                <div className="py-12 text-center text-sm text-charcoal/40">Loading tasks...</div>
            ) : tasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-charcoal/10 bg-white px-5 py-12 text-center">
                    <h4 className="font-semibold">No tasks assigned</h4>
                    <p className="mt-1 text-sm text-charcoal/40">You don't have any tasks assigned to you yet.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map(task => <TaskCard key={task._id} task={task} onEdit={openEdit} onView={openView} />)}
                </div>
            )}

            {/* Update Modal */}
            {editTask && (
                <ModalBox open={!!editTask} onClose={closeEdit} size="lg" title="Update Task">
                    <div className="space-y-5">
                        <div>
                            <h4 className="font-heading font-bold">{editTask.title}</h4>
                            <p className="mt-1 text-sm text-charcoal/45">Update your current task progress.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            <div>
                                <label className="mb-2 block text-sm font-medium">Status</label>
                                <select value={status} onChange={e => setStatus(e.target.value)} className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                                    <option value="Todo">Todo</option>
                                    <option value="In Progress">In Progress</option>
                                    <option value="Review">Review</option>
                                    <option value="Completed">Completed</option>
                                </select>
                            </div>
                            <Input label="Progress (%)" type="number" min="0" max="100" value={progress} handleChange={e => setProgress(e.target.value)} />
                        </div>
                        <div>
                            <label className="mb-2 block text-sm font-medium">Notes</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="What have you completed? Any blockers?" className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                        </div>
                        <div className="flex justify-end gap-3 border-t border-charcoal/5 pt-5">
                            <button onClick={closeEdit} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                            <ButtonEmerald onClick={handleUpdate} disabled={loading}>Update Task</ButtonEmerald>
                        </div>
                    </div>
                </ModalBox>
            )}

            {/* View Modal */}
            {viewModel && (
                <ModalBox open={viewModel} onClose={() => setViewModel(false)} size="xl" title="">
                    <div>
                        <div className="flex items-start justify-between gap-3">
                            <h3 className="font-heading text-xl font-bold text-charcoal">{viewTask.title}</h3>
                            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${viewTask.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' : viewTask.status === 'In Progress' ? 'bg-blue-50 text-blue-600' : viewTask.status === 'Review' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-600'}`}>{viewTask.status}</span>
                        </div>
                        {viewTask.description && <p className="my-2 w-full rounded-xl bg-charcoal/[0.03] p-4 text-sm leading-6 text-charcoal/55">{viewTask.description}</p>}
                    </div>
                    <div className="rounded-xl border border-charcoal/5 bg-charcoal/[0.02] p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-charcoal/60">Task Progress</span>
                            <span className="text-sm font-bold text-blue-600">{viewTask.progress ?? 0}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-charcoal/10">
                            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${viewTask.progress ?? 0}%` }} />
                        </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-charcoal/5 p-4">
                            <div className="flex items-center gap-2 text-xs text-charcoal/40"><FiFlag className="size-4" /> Priority</div>
                            <p className="mt-2 text-sm font-semibold">{viewTask.priority || 'Medium'}</p>
                        </div>
                        <div className="space-y-3">
                            <div className="rounded-xl border border-charcoal/5 p-4">
                                <div className="flex items-center gap-2 text-xs text-charcoal/40"><FiClock className="size-4" /> Start Date</div>
                                <p className="mt-2 text-sm font-semibold">{viewTask.startDate ? new Date(viewTask.startDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set'}</p>
                            </div>
                            <div className="rounded-xl border border-charcoal/5 p-4">
                                <div className="flex items-center gap-2 text-xs text-charcoal/40"><FiCalendar className="size-4" /> Due Date</div>
                                <p className="mt-2 text-sm font-semibold">{viewTask.dueDate ? new Date(viewTask.dueDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set'}</p>
                            </div>
                        </div>
                    </div>
                    {viewTask.notes && (
                        <div className="mt-3">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><FiFileText className="size-4" /> Notes</div>
                            <div className="w-full rounded-xl bg-charcoal/[0.03] p-4 text-sm leading-6 text-charcoal/55">{viewTask.notes}</div>
                        </div>
                    )}
                </ModalBox>
            )}
        </>
    )
}

// ---- TaskCard (local, unchanged) ----
const TaskCard = ({ task, onEdit, onView }: { task: Task; onEdit: (task: Task) => void; onView: (task: Task) => void }) => {
    const project = typeof task.projectId === 'object' ? task.projectId : null
    return (
        <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-heading font-bold">{task.title}</h4>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${task.priority === 'Urgent' ? 'bg-red-50 text-red-600' : task.priority === 'High' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>{task.priority}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-charcoal/45"><FiFolder className="size-3.5" />{project?.name || 'Project'}</div>
                </div>
                <div className="flex items-center justify-center gap-0.5">
                    <button onClick={() => onView(task)} className="rounded-lg p-2 text-emreald hover:bg-blue-50" title="View task"><FaEye className="size-4" /></button>
                    <button onClick={() => onEdit(task)} className="rounded-lg p-2 text-blue-500 hover:bg-blue-50" title="Update task"><FiEdit className="size-4" /></button>
                </div>
            </div>
            {task.description && <p className="mt-4 text-sm leading-6 text-charcoal/50">{task.description}</p>}
            <div className="mt-5">
                <div className="mb-2 flex justify-between">
                    <span className="text-xs font-medium text-charcoal/45">Progress</span>
                    <span className="text-xs font-bold">{task.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-charcoal/5">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${task.progress}%` }} />
                </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${task.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' : task.status === 'In Progress' ? 'bg-blue-50 text-blue-600' : task.status === 'Review' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-600'}`}>{task.status}</span>
                {task.dueDate && <div className="flex items-center gap-1.5 text-xs text-charcoal/40"><FiCalendar className="size-3.5" />Due {new Date(task.dueDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
            </div>
        </div>
    )
}

export default EmployeeTasks