'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { FiArrowLeft, FiCalendar, FiDollarSign, FiEdit, FiUsers } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchProject, Project } from '@/services/project.services'
import Expenses from '@/components/expenses/Expenses'
import TaskManagment from '@/components/expenses/TaskManagment'
import { StatCard, ProjectStatus } from '@/components/ui/shared'
import { formatCurrency, formatMoney } from '@/lib/utils'
import { fetchProjectExpenses, type CurrencyTotal } from '@/services/expense.services'

const ProjectDetailsPage = () => {
    const router = useRouter()
    const params = useParams()
    const { token, role } = useAuth()
    const toast = useToast()
    const projectId = params.id as string

    const [project, setProject] = useState<Project | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (token && projectId) loadProject()
    }, [token, projectId])

    const loadProject = async () => {
        if (!token) return
        setLoading(true)
        try {
            const response = await fetchProject(token, projectId)
            if (response.success) {
                setProject(response.data ?? null)
            } else {
                toast.showError(response.message || 'Failed to load project')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to load project')
        } finally {
            setLoading(false)
        }
    }

    if (role !== 'admin') router.push('/projects')

    if (loading) {
        return <div className="py-10 text-center text-sm text-charcoal/50">Loading project...</div>
    }
    if (!project) {
        return (
            <div className="py-10 text-center">
                <p className="text-sm text-red-500">Project not found</p>
                <button onClick={() => router.push('/projects')} className="mt-4 text-sm font-medium text-blue-600">Back to Projects</button>
            </div>
        )
    }

    const employeeCount = project.employees?.length ?? 0

    return (
        <div className="space-y-6 py-4 lg:py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <button onClick={() => router.push('/projects')} className="mb-4 flex items-center gap-2 text-sm text-charcoal/50 transition hover:text-charcoal">
                        <FiArrowLeft className="size-4" /> Back to Projects
                    </button>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-2xl font-bold font-heading text-charcoal">{project.name}</h1>
                        <ProjectStatus status={project.status} />
                    </div>
                    <p className="mt-1 text-sm text-charcoal/50">{project.clientName}</p>
                </div>
                <button onClick={() => router.push(`/projects?edit=${project._id}`)} className="flex items-center justify-center gap-2 rounded-xl border border-charcoal/10 bg-white px-4 py-2.5 text-sm font-medium text-charcoal transition hover:bg-charcoal/[0.03]">
                    <FiEdit className="size-4" /> Edit Project
                </button>
            </div>

            {project.description && (
                <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm">
                    <p className="text-sm leading-6 text-charcoal/60">{project.description}</p>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard title="Project Budget" value={formatMoney(project.budget)} icon={<FiDollarSign />} />
                <ProjectExpenseStat projectId={project._id} budget={project.budget} />
                <StatCard title="Employees" value={String(employeeCount)} icon={<FiUsers />} />
                <StatCard title="Deadline" value={project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline'} icon={<FiCalendar />} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 items-start gap-2">
                <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <Expenses projectId={project._id} showProject={false} onExpenseChange={loadProject} />
                </div>
                <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <TaskManagment projectId={project._id} />
                </div>
            </div>
        </div>
    )
}

// Project expense total, per currency (the API returns totalExpense = null when currencies are mixed)
const ProjectExpenseStat = ({ projectId }: { projectId: string; budget: number }) => {
    const { token } = useAuth()
    const [totals, setTotals] = useState<CurrencyTotal[]>([])

    useEffect(() => {
        if (!token) return
        const load = async () => {
            try {
                const response = await fetchProjectExpenses(token, projectId)
                if (response.success) setTotals(response.data?.totalsByCurrency ?? [])
            } catch (error) { console.error(error) }
        }
        load()
    }, [token, projectId])

    const value = totals.length ? totals.map(t => formatCurrency(t.total, t.currency)).join(' + ') : formatMoney(0)
    return <StatCard title="Total Expenses" value={value} subtitle="Rejected expenses excluded" icon={<FiDollarSign />} />
}

export default ProjectDetailsPage