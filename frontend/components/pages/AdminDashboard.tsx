'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { FiArrowRight, FiBriefcase, FiCalendar, FiCheckCircle, FiCheckSquare, FiClock, FiDollarSign, FiFileText, FiList, FiUsers, FiTrendingUp, FiAlertCircle } from 'react-icons/fi'
import LockedValue from '@/components/ui/LockedValue'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchDashboard, DashboardData } from '@/services/dashboard.services'
import { StatCard, SectionHeader, EmptyState, ProjectStatus } from '@/components/ui/shared'
import { DaySummary, fetchDaySummary } from '@/services/deliverable.services'

const AdminDashboard = () => {
    const { token } = useAuth()
    const toast = useToast()
    const [dashboard, setDashboard] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (token) loadDashboard()
    }, [token])

    const loadDashboard = async () => {
        if (!token) return
        setLoading(true)
        try {
            const response = await fetchDashboard(token)
            if (response.success) {
                setDashboard(response.data ?? null)
            } else {
                toast.showError(response.message || 'Failed to load dashboard')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to load dashboard')
        } finally {
            setLoading(false)
        }
    }

    if (loading) return <DashboardSkeleton />
    if (!dashboard) {
        return (
            <div className="py-10 text-center">
                <p className="text-sm text-charcoal/50">Unable to load dashboard.</p>
                <button onClick={loadDashboard} className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">
                    Try again
                </button>
            </div>
        )
    }

    return (
        <div className="space-y-6 py-4 lg:py-6">
            <div className="flex flex-col gap-1">
                <h1 className="font-heading text-xl font-bold text-charcoal sm:text-2xl">Dashboard</h1>
                <p className="text-sm text-charcoal/50">Here's an overview of your business activity.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard title="Total Projects" value={dashboard.projects.total} subtitle={`${dashboard.projects.active} active projects`} icon={<FiBriefcase className="size-5" />} href="/projects" />
                <StatCard title="Employees" value={dashboard.employees.total} subtitle={`${dashboard.employees.active} active employees`} icon={<FiUsers className="size-5" />} href="/employees" />
                {/* Company-wide finance figures are calculated in the Owner Console's Finance view. */}
                <StatCard title="Total Expenses" value={<LockedValue />} icon={<FiDollarSign className="size-5" />} href="/expenses" />
                <StatCard title="Remaining Budget" value={<LockedValue />} icon={<FiTrendingUp className="size-5" />} href="/projects" />
            </div>

            <TodaysPlans />

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MiniStat label="Active" value={dashboard.projects.active} icon={<FiClock />} iconClass="bg-emerald-50 text-emerald-600" />
                <MiniStat label="Planning" value={dashboard.projects.planning} icon={<FiCalendar />} iconClass="bg-blue-50 text-blue-600" />
                <MiniStat label="Completed" value={dashboard.projects.completed} icon={<FiCheckCircle />} iconClass="bg-green-50 text-green-600" />
                <MiniStat label="On Hold" value={dashboard.projects.onHold} icon={<FiAlertCircle />} iconClass="bg-amber-50 text-amber-600" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                    <SectionHeader title="Recent Projects" href="/projects" action="View all" />
                    <div className="divide-y divide-charcoal/5">
                        {dashboard.recentProjects.length === 0 ? <EmptyState text="No projects found." /> : dashboard.recentProjects.map((project) => <ProjectRow key={project._id} project={project} />)}
                    </div>
                </div>

                <div className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                    <SectionHeader title="Recent Expenses" href="/expenses" action="View all" />
                    <div className="divide-y divide-charcoal/5">
                        {dashboard.recentExpenses.length === 0 ? <EmptyState text="No expenses found." /> : dashboard.recentExpenses.map((expense) => <ExpenseRow key={expense._id} expense={expense} />)}
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                <SectionHeader title="Expenses by Project" href="/expenses" action="View expenses" />
                <div className="p-5 sm:p-6"><LockedValue /></div>
            </div>
        </div>
    )
}

// ----- MiniStat (unchanged) -----
const MiniStat = ({ label, value, icon, iconClass }: { label: any, value: any, icon: any, iconClass: any }) => (
    <div className="flex items-center gap-3 rounded-2xl border border-charcoal/5 bg-white p-4 shadow-sm">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>{icon}</div>
        <div className="min-w-0">
            <p className="text-lg font-bold text-charcoal">{value}</p>
            <p className="truncate text-xs text-charcoal/45">{label}</p>
        </div>
    </div>
)

// ----- ProjectRow (unchanged) -----
const ProjectRow = ({ project }: { project: any }) => (
    <Link href={`/projects/${project._id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-charcoal/[0.02] sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <FiBriefcase className="size-4" />
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-charcoal">{project.name}</p>
                <p className="mt-0.5 truncate text-xs text-charcoal/45">{project.clientName || 'No client'}</p>
            </div>
        </div>
        <div className="shrink-0 text-right">
            <ProjectStatus status={project.status} />
            <p className="mt-1 text-xs text-charcoal/40">{project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline'}</p>
        </div>
    </Link>
)

// ----- ExpenseRow (unchanged) -----
const ExpenseRow = ({ expense }:{ expense:any }) => {
    const projectName = expense.projectId && typeof expense.projectId === 'object' ? expense.projectId.name : 'No project'
    return (
        <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600" />
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-charcoal">{expense.description}</p>
                    <p className="mt-0.5 truncate text-xs text-charcoal/45">{projectName}</p>
                </div>
            </div>
            <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-charcoal">{expense.currency} {Number(expense.totalAmount || 0).toFixed(2)}</p>
                <p className="mt-0.5 text-xs text-charcoal/40">{expense.date ? new Date(expense.date).toLocaleDateString() : ''}</p>
            </div>
        </div>
    )
}

// ----- DashboardSkeleton (unchanged) -----
const DashboardSkeleton = () => (
    <div className="space-y-6 py-4 lg:py-6">
        <div className="space-y-2">
            <div className="h-7 w-32 animate-pulse rounded-lg bg-charcoal/5" />
            <div className="h-4 w-72 animate-pulse rounded bg-charcoal/5" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-white shadow-sm" />)}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white shadow-sm" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" />
            <div className="h-80 animate-pulse rounded-2xl bg-white shadow-sm" />
        </div>
    </div>
)

export default AdminDashboard

// Daily deliverables for today. Loaded separately, so the rest of the dashboard shows even if this fails.
const TodaysPlans = () => {
    const { token } = useAuth()
    const [summary, setSummary] = useState<DaySummary | null>(null)

    useEffect(() => {
        if (!token) return
        fetchDaySummary(token).then(r => setSummary(r.data ?? null)).catch(() => setSummary(null))
    }, [token])

    if (!summary) return null
    const of = `of ${summary.activeEmployees} active employee${summary.activeEmployees === 1 ? '' : 's'}`
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard title="Plans submitted today" value={summary.plansSubmitted} subtitle={of} icon={<FiList className="size-5" />} href="/deliverables/team" />
            <StatCard title="Waiting for approval" value={summary.plansPendingApproval} subtitle="Plans to approve" icon={<FiCheckSquare className="size-5" />} href="/deliverables/approvals" />
            <StatCard title="EODs submitted today" value={summary.eodsSubmitted} subtitle={of} icon={<FiFileText className="size-5" />} href="/eod" />
        </div>
    )
}
