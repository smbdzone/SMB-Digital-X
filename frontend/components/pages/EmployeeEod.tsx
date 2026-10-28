'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiCalendar, FiEdit2, FiEye, FiPlus, FiSend } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    EODPagination,
    EODReport,
    EODStatus,
    fetchEmployeeEOD,
    submitEOD,
    updateEOD,
} from '@/services/eod.services'
import { ApiError, apiClient } from '@/lib/apiClient'
import ButtonEmerald from '../ui/ButtonEmerald'
import ModalBox from '../ui/ModalBox'
import Input from '../ui/Input'
import Pagination from '../ui/Pagination'
import { StatusBadge, InfoBox, ReportSection, TaskList, TextAreaField, TaskStatusButton } from '@/components/ui/shared'
import { errorMessage, formatDate } from '@/lib/utils'
import { formatDayKey, reportDayKey, shiftDayKey, todayKey } from '@/lib/eodDate'

interface Task { _id: string; title: string; status?: string; progress?: number }
type TaskWorkStatus = 'none' | 'progress' | 'completed'
type FormMode = 'create' | 'edit' | null

const PAGE_SIZE = 10

// Same limits as the backend (eod.controller.ts)
const LIMITS: Record<string, number> = { summary: 5000, blockers: 2000, tomorrowPlan: 2000 }

const EMPTY_FORM = { summary: '', blockers: '', tomorrowPlan: '', overallProgress: '0' }

// "" stays "", anything else becomes a whole number between 0 and 100
const clampProgress = (value: string) => {
    if (value === '') return ''
    const n = Number(value)
    if (Number.isNaN(n)) return ''
    return String(Math.min(100, Math.max(0, Math.round(n))))
}

const EmployeeEOD = () => {
    const { token } = useAuth()
    const toast = useToast()

    const [tasks, setTasks] = useState<Task[]>([])
    const [reports, setReports] = useState<EODReport[]>([])
    const [pagination, setPagination] = useState<EODPagination | null>(null)
    const [page, setPage] = useState(1)
    const [todayReport, setTodayReport] = useState<EODReport | null>(null)
    const [listLoading, setListLoading] = useState(false)
    const [todayLoading, setTodayLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [tasksLoading, setTasksLoading] = useState(false)
    const [formMode, setFormMode] = useState<FormMode>(null)
    const [viewReport, setViewReport] = useState<EODReport | null>(null)
    const [filterStatus, setFilterStatus] = useState<'all' | EODStatus>('all')

    const [form, setForm] = useState(EMPTY_FORM)
    const [taskStatus, setTaskStatus] = useState<Record<string, TaskWorkStatus>>({})

    // Ignore answers of older requests (fast page / filter changes)
    const listRequest = useRef(0)

    // ------------------------------------------------------------
    // Load
    // ------------------------------------------------------------

    const loadToday = useCallback(async () => {
        if (!token) return
        setTodayLoading(true)
        try {
            const today = todayKey()
            const response = await fetchEmployeeEOD(token, { from: today, to: today, limit: 1 })
            setTodayReport(response.data?.[0] ?? null)
        } catch (error) {
            console.log(error)
            toast.showError(errorMessage(error, "Failed to load today's EOD report"))
        } finally {
            setTodayLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    const loadPrevious = useCallback(async () => {
        if (!token) return
        const requestId = ++listRequest.current
        setListLoading(true)
        try {
            const response = await fetchEmployeeEOD(token, {
                // everything before today; today has its own card
                to: shiftDayKey(todayKey(), -1),
                status: filterStatus === 'all' ? undefined : filterStatus,
                page,
                limit: PAGE_SIZE,
            })
            if (requestId !== listRequest.current) return
            setReports(response.data ?? [])
            setPagination(response.pagination ?? null)
        } catch (error) {
            if (requestId !== listRequest.current) return
            console.log(error)
            toast.showError(errorMessage(error, 'Failed to load EOD reports'))
        } finally {
            if (requestId === listRequest.current) setListLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, page, filterStatus])

    const fetchTasks = useCallback(async () => {
        if (!token) return
        setTasksLoading(true)
        try {
            const response = await apiClient<any>('/tasks/employee', { token })
            if (response.success) setTasks(response.data ?? [])
        } catch (error) {
            console.log(error)
            toast.showError(errorMessage(error, 'Failed to load tasks'))
        } finally {
            setTasksLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    useEffect(() => {
        if (!token) return
        void loadToday()
        void fetchTasks()
    }, [token, loadToday, fetchTasks])

    useEffect(() => {
        void loadPrevious()
    }, [loadPrevious])

    // ------------------------------------------------------------
    // Form
    // ------------------------------------------------------------

    // Tasks shown in the form: assigned open tasks + tasks already on the report being edited
    const formTasks = useMemo(() => {
        if (formMode !== 'edit' || !todayReport) return tasks
        const known = new Set(tasks.map(t => t._id))
        const extra = [...todayReport.completedTasks, ...todayReport.inProgressTasks].filter(t => !known.has(t._id))
        return [...tasks, ...extra]
    }, [tasks, formMode, todayReport])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        if (name === 'overallProgress') {
            setForm(prev => ({ ...prev, overallProgress: clampProgress(value) }))
            return
        }
        const max = LIMITS[name]
        setForm(prev => ({ ...prev, [name]: max ? value.slice(0, max) : value }))
    }

    const changeTaskStatus = (id: string, status: TaskWorkStatus) => {
        setTaskStatus(prev => ({ ...prev, [id]: status }))
    }

    const openCreateModal = () => {
        if (todayReport) {
            toast.showError("You have already submitted today's EOD report")
            return
        }
        setForm(EMPTY_FORM)
        setTaskStatus({})
        setFormMode('create')
    }

    const openEditModal = () => {
        if (!todayReport) return
        if (todayReport.status === 'Reviewed') {
            toast.showError('This report has already been reviewed and can no longer be edited')
            return
        }
        setForm({
            summary: todayReport.summary ?? '',
            blockers: todayReport.blockers ?? '',
            tomorrowPlan: todayReport.tomorrowPlan ?? '',
            overallProgress: String(todayReport.overallProgress ?? 0),
        })
        const current: Record<string, TaskWorkStatus> = {}
        todayReport.completedTasks.forEach(t => { current[t._id] = 'completed' })
        todayReport.inProgressTasks.forEach(t => { current[t._id] = 'progress' })
        setTaskStatus(current)
        setFormMode('edit')
    }

    const closeForm = () => setFormMode(null)

    const handleSubmit = async () => {
        if (!token || !formMode) return

        const summary = form.summary.trim()
        if (!summary) {
            toast.showError("Please enter today's summary")
            return
        }

        const progress = Number(form.overallProgress)
        if (form.overallProgress === '' || Number.isNaN(progress) || progress < 0 || progress > 100) {
            toast.showError('Overall progress must be between 0 and 100')
            return
        }

        const completedTasks = Object.entries(taskStatus).filter(([, s]) => s === 'completed').map(([id]) => id)
        const inProgressTasks = Object.entries(taskStatus).filter(([, s]) => s === 'progress').map(([id]) => id)

        const payload = {
            summary,
            completedTasks,
            inProgressTasks,
            blockers: form.blockers.trim(),
            tomorrowPlan: form.tomorrowPlan.trim(),
            overallProgress: progress,
        }

        setSaving(true)
        try {
            const response = formMode === 'edit' && todayReport
                ? await updateEOD(todayReport._id, token, payload)
                : await submitEOD(token, payload)

            toast.showSuccess(response.message || (formMode === 'edit' ? 'EOD report updated successfully' : 'EOD report submitted successfully'))
            closeForm()
            await Promise.all([loadToday(), loadPrevious()])
        } catch (error) {
            console.log(error)
            // Show the backend's own message (already submitted, already reviewed, invalid tasks...)
            toast.showError(errorMessage(error, 'Failed to save EOD report'))
            // 409 = the server state is different from what this screen shows: refresh it
            if (error instanceof ApiError && error.status === 409) {
                closeForm()
                await loadToday()
            }
        } finally {
            setSaving(false)
        }
    }

    const handleFilterChange = (value: 'all' | EODStatus) => {
        setFilterStatus(value)
        setPage(1)
    }

    const isEdit = formMode === 'edit'
    const today = todayKey()

    return (
        <>
            {/* Header */}
            <div className="py-4 lg:py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-md sm:text-xl font-bold font-heading">End of Day Reports</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Submit and review your daily work reports.</p>
                </div>
                {!todayReport && !todayLoading && <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openCreateModal}>Create EOD Report</ButtonEmerald>}
            </div>

            {/* Today's EOD */}
            <div className="mb-6 rounded-xl border border-charcoal/5 bg-white p-5 shadow">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-500"><FiCalendar className="size-5" /></div>
                        <div>
                            <p className="text-xs text-charcoal/40">Today's EOD</p>
                            <h3 className="mt-0.5 font-heading font-bold">{formatDayKey(today)}</h3>
                        </div>
                    </div>
                    {todayLoading && !todayReport ? (
                        <span className="text-xs text-charcoal/40">Loading...</span>
                    ) : todayReport ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <StatusBadge status={todayReport.status} variant="eod" />
                            {todayReport.status === 'Submitted' && (
                                <button onClick={openEditModal} className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100">
                                    <FiEdit2 className="size-4" /> Edit Report
                                </button>
                            )}
                            <button onClick={() => setViewReport(todayReport)} className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-100">
                                <FiEye className="size-4" /> View Report
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3">
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">Not Submitted</span>
                            <ButtonEmerald onClick={openCreateModal}>Create Report</ButtonEmerald>
                        </div>
                    )}
                </div>
            </div>

            {/* Previous Reports */}
            <div>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-lg font-bold font-heading">Previous Reports</h3>
                        <p className="mt-1 text-xs text-charcoal/40">View your previous daily reports.</p>
                    </div>
                    <select value={filterStatus} onChange={e => handleFilterChange(e.target.value as 'all' | EODStatus)} className="h-10 rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500">
                        <option value="all">All Reports</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Reviewed">Reviewed</option>
                    </select>
                </div>

                <div className="overflow-x-auto rounded-lg bg-white shadow">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {listLoading ? (
                                <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                            ) : reports.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">No previous EOD reports found</td></tr>
                            ) : (
                                reports.map(report => (
                                    <tr key={report._id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDayKey(reportDayKey(report))}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex min-w-[60px] items-center gap-3">
                                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${report.overallProgress}%` }} />
                                                </div>
                                                <span className="text-xs font-semibold">{report.overallProgress}%</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4"><StatusBadge status={report.status} variant="eod" /></td>
                                        <td className="px-6 py-4">
                                            <button onClick={() => setViewReport(report)} className="text-blue-600 transition hover:text-blue-900"><FiEye className="size-4" /></button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <Pagination
                    page={pagination?.page ?? page}
                    pages={pagination?.pages ?? 1}
                    total={pagination?.total ?? reports.length}
                    onChange={setPage}
                    disabled={listLoading}
                />
            </div>

            {/* Create / Edit EOD Modal */}
            {formMode && (
                <ModalBox open={!!formMode} onClose={closeForm} size="2xl" title={isEdit ? 'Edit EOD Report' : 'Create EOD Report'}>
                    <div className="space-y-6">
                        <div className="rounded-xl bg-charcoal/[0.03] p-4">
                            <p className="text-xs text-charcoal/40">Report Date</p>
                            <p className="mt-1 text-sm font-semibold">{formatDayKey(isEdit && todayReport ? reportDayKey(todayReport) : today)}</p>
                        </div>

                        <div>
                            <div className="mb-3">
                                <h3 className="font-heading font-bold">Today's Tasks</h3>
                                <p className="mt-1 text-xs text-charcoal/40">Select the status of each task you worked on.</p>
                            </div>
                            {tasksLoading ? (
                                <div className="rounded-xl bg-charcoal/[0.03] p-4 text-center text-sm text-charcoal/40">Loading tasks...</div>
                            ) : formTasks.length === 0 ? (
                                <div className="rounded-xl bg-charcoal/[0.03] p-4 text-center text-sm text-charcoal/40">No tasks assigned.</div>
                            ) : (
                                <div className="space-y-2">
                                    {formTasks.map(task => {
                                        const current = taskStatus[task._id] || 'none'
                                        return (
                                            <div key={task._id} className="rounded-xl border border-charcoal/5 p-4">
                                                <div className="mb-3 flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold">{task.title}</p>
                                                        {typeof task.progress === 'number' && (
                                                            <p className="mt-1 text-xs text-charcoal/40">Current progress: {task.progress}%</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <TaskStatusButton active={current === 'none'} onClick={() => changeTaskStatus(task._id, 'none')}>Not Worked</TaskStatusButton>
                                                    <TaskStatusButton active={current === 'progress'} type="progress" onClick={() => changeTaskStatus(task._id, 'progress')}>In Progress</TaskStatusButton>
                                                    <TaskStatusButton active={current === 'completed'} type="completed" onClick={() => changeTaskStatus(task._id, 'completed')}>Completed</TaskStatusButton>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <Input label="Overall Progress (0-100)" name="overallProgress" type="number" min="0" max="100" value={form.overallProgress} handleChange={handleChange} placeholder="Overall progress %" />
                        <TextAreaField label="Today's Summary" name="summary" value={form.summary} onChange={handleChange} required placeholder="What did you accomplish today?" />
                        <TextAreaField label="Blockers / Issues" name="blockers" value={form.blockers} onChange={handleChange} placeholder="Any issue blocking your work?" />
                        <TextAreaField label="Tomorrow's Plan" name="tomorrowPlan" value={form.tomorrowPlan} onChange={handleChange} placeholder="What do you plan to work on tomorrow?" />

                        <div className="flex justify-end gap-3 border-t border-charcoal/5 pt-5">
                            <button onClick={closeForm} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                            <ButtonEmerald onClick={handleSubmit} disabled={saving} icon={<FiSend className="size-4" />}>
                                {saving ? (isEdit ? 'Saving...' : 'Submitting...') : (isEdit ? 'Save Changes' : 'Submit EOD')}
                            </ButtonEmerald>
                        </div>
                    </div>
                </ModalBox>
            )}

            {/* View EOD Modal */}
            {viewReport && (
                <ModalBox open={!!viewReport} onClose={() => setViewReport(null)} size="2xl" title="EOD Report">
                    <div className="space-y-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs text-charcoal/40">Report Date</p>
                                <h3 className="mt-1 font-heading text-lg font-bold">{formatDayKey(reportDayKey(viewReport))}</h3>
                            </div>
                            <StatusBadge status={viewReport.status} variant="eod" />
                        </div>
                        <InfoBox title="Overall Progress" value={`${viewReport.overallProgress}%`} />
                        <ReportSection title="Today's Summary" content={viewReport.summary} />
                        <TaskList title="Completed Tasks" tasks={viewReport.completedTasks} type="completed" />
                        <TaskList title="In Progress" tasks={viewReport.inProgressTasks} type="progress" />
                        {viewReport.blockers && <ReportSection title="Blockers / Issues" content={viewReport.blockers} />}
                        {viewReport.tomorrowPlan && <ReportSection title="Tomorrow's Plan" content={viewReport.tomorrowPlan} />}
                        {viewReport.status === 'Reviewed' && (
                            <div className="rounded-xl bg-emerald-50 p-4">
                                <p className="text-xs font-medium text-emerald-600">Reviewed By</p>
                                <p className="mt-1 text-sm font-semibold text-emerald-700">{viewReport.reviewedBy?.name ?? 'Admin'}</p>
                                {viewReport.reviewedAt && <p className="mt-1 text-xs text-emerald-600/70">{formatDate(viewReport.reviewedAt)}</p>}
                                {viewReport.reviewNote && <p className="mt-3 whitespace-pre-wrap text-sm text-emerald-800">{viewReport.reviewNote}</p>}
                            </div>
                        )}
                        <div className="flex justify-end border-t border-charcoal/5 pt-5">
                            <button onClick={() => setViewReport(null)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Close</button>
                        </div>
                    </div>
                </ModalBox>
            )}
        </>
    )
}

export default EmployeeEOD
