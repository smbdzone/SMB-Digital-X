'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiEye, FiSearch, FiCalendar, FiUserX, FiChevronDown, FiChevronUp } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    EODPagination,
    EODReport,
    EODStatus,
    MissingEODData,
    fetchAllEOD,
    fetchMissingEOD,
    reviewEOD,
} from '@/services/eod.services'
import { ApiError } from '@/lib/apiClient'
import ButtonEmerald from '../ui/ButtonEmerald'
import ModalBox from '../ui/ModalBox'
import Pagination from '../ui/Pagination'
import { StatusBadge, InfoBox, ReportSection, TaskList, SummaryCard, TextAreaField } from '@/components/ui/shared'
import { errorMessage, formatDate } from '@/lib/utils'
import { formatDayKey, reportDayKey, todayKey } from '@/lib/eodDate'

const PAGE_SIZE = 20
const SEARCH_LIMIT = 200 // backend maximum; used while searching so the search covers the whole day
const REVIEW_NOTE_MAX = 1000

const employeeOf = (report: EODReport) =>
    typeof report.employeeId === 'object' && report.employeeId !== null ? report.employeeId : null

const employeeIdOf = (report: EODReport) =>
    typeof report.employeeId === 'object' && report.employeeId !== null ? report.employeeId._id : String(report.employeeId)

const EODManagement = () => {
    const { token, user } = useAuth()
    const toast = useToast()
    const myId = user?.id ?? user?._id

    const [reports, setReports] = useState<EODReport[]>([])
    const [pagination, setPagination] = useState<EODPagination | null>(null)
    const [counts, setCounts] = useState({ pending: 0, reviewed: 0 })
    const [missing, setMissing] = useState<MissingEODData | null>(null)
    const [showMissing, setShowMissing] = useState(false)

    const [loading, setLoading] = useState(false)
    const [reviewing, setReviewing] = useState(false)
    const [selectedReport, setSelectedReport] = useState<EODReport | null>(null)
    const [reviewNote, setReviewNote] = useState('')

    const [date, setDate] = useState(todayKey())
    const [status, setStatus] = useState<'all' | EODStatus>('all')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)

    const searching = search.trim() !== ''
    const listRequest = useRef(0)

    // ------------------------------------------------------------
    // Load
    // ------------------------------------------------------------

    const loadReports = useCallback(async () => {
        if (!token || !date) return
        const requestId = ++listRequest.current
        setLoading(true)
        try {
            const response = await fetchAllEOD(token, {
                date,
                status: status === 'all' ? undefined : status,
                // while searching, load the whole day (search is done on the loaded rows)
                page: searching ? 1 : page,
                limit: searching ? SEARCH_LIMIT : PAGE_SIZE,
            })
            if (requestId !== listRequest.current) return
            setReports(response.data ?? [])
            setPagination(response.pagination ?? null)
        } catch (error) {
            if (requestId !== listRequest.current) return
            console.log(error)
            toast.showError(errorMessage(error, 'Failed to fetch EOD reports'))
        } finally {
            if (requestId === listRequest.current) setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, date, status, page, searching])

    // Totals for the cards come from the server (pagination.total), not from the visible page.
    const loadCounts = useCallback(async () => {
        if (!token || !date) return
        try {
            const [pending, reviewed] = await Promise.all([
                fetchAllEOD(token, { date, status: 'Submitted', limit: 1 }),
                fetchAllEOD(token, { date, status: 'Reviewed', limit: 1 }),
            ])
            setCounts({
                pending: pending.pagination?.total ?? 0,
                reviewed: reviewed.pagination?.total ?? 0,
            })
        } catch (error) {
            console.log(error)
        }
    }, [token, date])

    const loadMissing = useCallback(async () => {
        if (!token || !date) return
        try {
            const response = await fetchMissingEOD(token, { date })
            setMissing(response.data ?? null)
        } catch (error) {
            console.log(error)
            setMissing(null)
        }
    }, [token, date])

    useEffect(() => {
        void loadReports()
    }, [loadReports])

    useEffect(() => {
        void loadCounts()
        void loadMissing()
    }, [loadCounts, loadMissing])

    // ------------------------------------------------------------
    // Derived
    // ------------------------------------------------------------

    const filteredReports = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return reports
        return reports.filter(report => {
            const employee = employeeOf(report)
            const name = employee?.name?.toLowerCase() || ''
            const email = employee?.email?.toLowerCase() || ''
            return name.includes(query) || email.includes(query)
        })
    }, [reports, search])

    const totalReports = counts.pending + counts.reviewed

    // ------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------

    const openReport = (report: EODReport) => {
        setSelectedReport(report)
        setReviewNote('')
    }

    const closeReport = () => {
        setSelectedReport(null)
        setReviewNote('')
    }

    const refreshAll = async () => {
        await Promise.all([loadReports(), loadCounts(), loadMissing()])
    }

    const handleReview = async () => {
        if (!token || !selectedReport) return
        setReviewing(true)
        try {
            const response = await reviewEOD(selectedReport._id, token, reviewNote)
            toast.showSuccess(response.message || 'EOD report marked as reviewed')
            closeReport()
            await refreshAll()
        } catch (error) {
            console.log(error)
            // e.g. "already been reviewed" (409) or "cannot review your own report" (403)
            toast.showError(errorMessage(error, 'Failed to review report'))
            if (error instanceof ApiError && error.status === 409) {
                closeReport()
                await refreshAll()
            }
        } finally {
            setReviewing(false)
        }
    }

    const handleDateChange = (value: string) => {
        if (!value) return
        setDate(value)
        setPage(1)
    }

    const handleStatusChange = (value: 'all' | EODStatus) => {
        setStatus(value)
        setPage(1)
    }

    const selectedEmployee = selectedReport ? employeeOf(selectedReport) : null
    const isOwnReport = selectedReport ? employeeIdOf(selectedReport) === myId : false

    return (
        <>
            <div className="py-4 lg:py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-md sm:text-xl font-bold font-heading">EOD Reports</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Review employee end of day reports.</p>
                </div>
                <div className="flex items-center gap-2">
                    <FiCalendar className="size-4 text-charcoal/40" />
                    <input type="date" value={date} onChange={(e) => handleDateChange(e.target.value)} className="h-11 rounded-xl border border-charcoal/10 bg-white px-3 text-sm text-charcoal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </div>
            </div>

            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <SummaryCard title="Total Reports" value={totalReports} />
                <SummaryCard title="Pending Review" value={counts.pending} />
                <SummaryCard title="Reviewed" value={counts.reviewed} />
                <SummaryCard title="Not Submitted" value={missing?.missingCount ?? '-'} subtitle={missing ? `of ${missing.totalEmployees} active employees` : undefined} />
            </div>

            {/* Employees who have not submitted for the selected date */}
            {missing && missing.missingCount > 0 && (
                <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50/50">
                    <button
                        type="button"
                        onClick={() => setShowMissing(prev => !prev)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                        <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                            <FiUserX className="size-4" />
                            {missing.missingCount} employee{missing.missingCount === 1 ? '' : 's'} without an EOD report for {formatDayKey(missing.date)}
                        </span>
                        {showMissing ? <FiChevronUp className="size-4 text-amber-700" /> : <FiChevronDown className="size-4 text-amber-700" />}
                    </button>
                    {showMissing && (
                        <div className="grid grid-cols-1 gap-2 border-t border-amber-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
                            {missing.missing.map(employee => (
                                <div key={employee._id} className="rounded-lg bg-white px-3 py-2 shadow-sm">
                                    <p className="text-sm font-medium text-gray-900">{employee.name}</p>
                                    <p className="text-xs text-gray-400">{employee.email}</p>
                                    {employee.position && <p className="mt-0.5 text-xs text-gray-400">{employee.position}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                    <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal/35" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="h-11 w-full rounded-xl border border-charcoal/10 bg-white pl-10 pr-3 text-sm outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </div>
                <select value={status} onChange={(e) => handleStatusChange(e.target.value as 'all' | EODStatus)} className="h-11 rounded-xl border border-charcoal/10 bg-white px-3 text-sm text-charcoal outline-none transition focus:border-blue-500">
                    <option value="all">All Status</option>
                    <option value="Submitted">Pending Review</option>
                    <option value="Reviewed">Reviewed</option>
                </select>
            </div>

            <div className="overflow-x-auto rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : filteredReports.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No EOD reports found for this date</td></tr>
                        ) : (
                            filteredReports.map(report => {
                                const employee = employeeOf(report)
                                return (
                                    <tr key={report._id}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div>
                                                <p className="text-sm font-medium text-gray-900">{employee?.name}</p>
                                                <p className="mt-0.5 text-xs text-gray-400">{employee?.email}</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDayKey(reportDayKey(report))}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex min-w-[140px] items-center gap-3">
                                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                                                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${report.overallProgress}%` }} />
                                                </div>
                                                <span className="text-xs font-semibold text-gray-600">{report.overallProgress}%</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap"><StatusBadge status={report.status} variant="eod" /></td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <button onClick={() => openReport(report)} className="text-blue-600 transition hover:text-blue-900" title="View Report"><FiEye className="size-4" /></button>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {!searching && (
                <Pagination
                    page={pagination?.page ?? page}
                    pages={pagination?.pages ?? 1}
                    total={pagination?.total ?? reports.length}
                    onChange={setPage}
                    disabled={loading}
                />
            )}

            {/* View Modal */}
            {selectedReport && (
                <ModalBox open={!!selectedReport} onClose={closeReport} size="2xl" title="EOD Report">
                    <div className="space-y-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold font-heading">{selectedEmployee?.name}</h3>
                                <p className="mt-1 text-sm text-charcoal/40">{selectedEmployee?.email}</p>
                                {selectedEmployee?.position && <p className="mt-0.5 text-xs text-charcoal/40">{selectedEmployee.position}</p>}
                            </div>
                            <StatusBadge status={selectedReport.status} variant="eod" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <InfoBox title="Report Date" value={formatDayKey(reportDayKey(selectedReport))} />
                            <InfoBox title="Overall Progress" value={`${selectedReport.overallProgress}%`} />
                        </div>
                        <ReportSection title="Today's Summary" content={selectedReport.summary} />
                        <TaskList title="Completed Tasks" tasks={selectedReport.completedTasks} type="completed" />
                        <TaskList title="In Progress" tasks={selectedReport.inProgressTasks} type="progress" />
                        {selectedReport.blockers && <ReportSection title="Blockers / Issues" content={selectedReport.blockers} />}
                        {selectedReport.tomorrowPlan && <ReportSection title="Tomorrow's Plan" content={selectedReport.tomorrowPlan} />}
                        {selectedReport.status === 'Reviewed' && (
                            <div className="rounded-xl bg-emerald-50 p-4">
                                <p className="text-xs font-medium text-emerald-600">Reviewed By</p>
                                <p className="mt-1 text-sm font-semibold text-emerald-700">{selectedReport.reviewedBy?.name ?? 'Admin'}</p>
                                {selectedReport.reviewedAt && <p className="mt-1 text-xs text-emerald-600/70">{formatDate(selectedReport.reviewedAt)}</p>}
                                {selectedReport.reviewNote && <p className="mt-3 whitespace-pre-wrap text-sm text-emerald-800">{selectedReport.reviewNote}</p>}
                            </div>
                        )}

                        {selectedReport.status === 'Submitted' && !isOwnReport && (
                            <TextAreaField
                                label="Review note (optional)"
                                name="reviewNote"
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value.slice(0, REVIEW_NOTE_MAX))}
                                placeholder="Add feedback for the employee"
                                rows={3}
                            />
                        )}
                        {selectedReport.status === 'Submitted' && isOwnReport && (
                            <p className="rounded-xl bg-charcoal/[0.03] p-3 text-xs text-charcoal/50">You cannot review your own report.</p>
                        )}

                        <div className="flex justify-end gap-3 border-t border-charcoal/5 pt-5">
                            <button onClick={closeReport} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-charcoal/5">Close</button>
                            {selectedReport.status === 'Submitted' && !isOwnReport && (
                                <ButtonEmerald onClick={handleReview} disabled={reviewing}>{reviewing ? 'Saving...' : 'Mark as Reviewed'}</ButtonEmerald>
                            )}
                        </div>
                    </div>
                </ModalBox>
            )}
        </>
    )
}

export default EODManagement
