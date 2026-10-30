'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
    FiArrowLeft, FiBriefcase, FiCheckCircle, FiDollarSign, FiEdit, FiInfo, FiLayers, FiList, FiTag, FiUsers,
} from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchProject, updateProject, Project } from '@/services/project.services'
import ModalBox from '@/components/ui/ModalBox'
import Input from '@/components/ui/Input'
import SelectField from '@/components/ui/SelectField'
import ButtonEmerald from '@/components/ui/ButtonEmerald'
import Expenses from '@/components/expenses/Expenses'
import TaskManagment from '@/components/expenses/TaskManagment'
import ProjectMilestones from '@/components/milestones/ProjectMilestones'
import ProjectOverview from '@/components/projects/ProjectOverview'
import { useProjectMilestones } from '@/hooks/useProjectMilestones'
import { StatCard, ProjectStatus, TextAreaField } from '@/components/ui/shared'
import { formatDay, toDateInput } from '@/lib/formatDay'
import { formatCurrency, formatMoney } from '@/lib/utils'
import { fetchProjectExpenses, type CurrencyTotal } from '@/services/expense.services'

type TabId = 'overview' | 'milestones' | 'expenses' | 'tasks'

const DAY = 86400000

// How far through its schedule the project is, and the days left (negative = overdue).
const schedule = (project: Project) => {
    if (!project.deadline) return null
    const start = new Date(project.startDate).getTime()
    const end = new Date(project.deadline).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) return null
    const now = Date.now()
    const total = end - start
    const percent = total > 0 ? Math.min(100, Math.max(0, ((now - start) / total) * 100)) : 100
    return { percent, days: Math.ceil((end - now) / DAY) }
}

const scheduleLabel = (project: Project, days: number) => {
    if (project.status === 'Completed') return 'Completed'
    if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`
    if (days === 0) return 'Due today'
    return `${-days} day${days === -1 ? '' : 's'} overdue`
}

const ProjectDetailsPage = () => {
    const router = useRouter()
    const params = useParams()
    const { token, role, loading: authLoading } = useAuth()
    const toast = useToast()
    const projectId = params.id as string

    const [project, setProject] = useState<Project | null>(null)
    const [loading, setLoading] = useState(true)
    const [tab, setTab] = useState<TabId>('overview')
    const milestones = useProjectMilestones(projectId)

    // Edit project window
    const [editOpen, setEditOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        name: '', clientName: '', category: '', startDate: '',
        deadline: '', budget: '', status: 'Planning', description: '',
    })

    useEffect(() => {
        if (!authLoading && role !== 'admin') router.replace('/projects')
    }, [authLoading, role, router])

    useEffect(() => {
        if (token && projectId) loadProject()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, projectId])

    // Open the tab named in the link (e.g. /projects/123#milestones)
    useEffect(() => {
        const hash = window.location.hash.replace('#', '')
        if (['overview', 'milestones', 'expenses', 'tasks'].includes(hash)) setTab(hash as TabId)
    }, [])

    const changeTab = (id: TabId) => {
        setTab(id)
        try { window.history.replaceState(null, '', `#${id}`) } catch { /* ignore */ }
    }

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

    const openEdit = () => {
        if (!project) return
        setForm({
            name: project.name,
            clientName: project.clientName,
            category: project.category ?? '',
            startDate: toDateInput(project.startDate),
            deadline: toDateInput(project.deadline),
            budget: String(project.budget),
            status: project.status,
            description: project.description ?? '',
        })
        setEditOpen(true)
    }

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const handleSave = async () => {
        if (!token || !project) return
        if (!form.name.trim() || !form.clientName.trim() || !form.category.trim() || !form.startDate) {
            return toast.showError('Please fill all required fields')
        }
        if (form.budget === '' || !Number.isFinite(Number(form.budget)) || Number(form.budget) < 0) {
            return toast.showError('Valid budget is required')
        }
        if (form.deadline && form.deadline < form.startDate) {
            return toast.showError('Deadline cannot be before the start date')
        }

        const payload = {
            name: form.name.trim(),
            clientName: form.clientName.trim(),
            category: form.category.trim(),
            description: form.description.trim(),
            startDate: form.startDate,
            deadline: form.deadline || undefined,
            budget: Number(form.budget),
            status: form.status as Project['status'],
        }

        setSaving(true)
        try {
            const response = await updateProject(token, project._id, payload)
            if (response.success) {
                toast.showSuccess('Project updated successfully')
                setProject(response.data ?? project)
                setEditOpen(false)
                milestones.reload() // the budget may have changed, so milestone amounts must refresh
            } else {
                toast.showError(response.message || 'Failed to update project')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to update project')
        } finally {
            setSaving(false)
        }
    }

    if (role !== 'admin') return null

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

    const team = project.employees ?? []
    const timeline = schedule(project)
    const summary = milestones.data?.summary

    const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
        { id: 'overview', label: 'Overview', icon: <FiInfo className="size-4" /> },
        { id: 'milestones', label: 'Milestones', icon: <FiLayers className="size-4" />, count: summary?.total },
        { id: 'expenses', label: 'Expenses', icon: <FiDollarSign className="size-4" /> },
        { id: 'tasks', label: 'Tasks', icon: <FiList className="size-4" /> },
    ]

    return (
        <div className="space-y-6 py-4 lg:py-6">
            <button onClick={() => router.push('/projects')} className="flex items-center gap-2 text-sm text-charcoal/50 transition hover:text-charcoal">
                <FiArrowLeft className="size-4" /> Back to Projects
            </button>

            {/* Header */}
            <div className="overflow-hidden rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                <div className="h-1.5 bg-gradient-to-r from-blue-500 to-blue-600" />
                <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 items-start gap-4">
                            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 font-heading text-xl font-bold text-blue-600">
                                {project.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-3">
                                    <h1 className="font-heading text-2xl font-bold text-charcoal">{project.name}</h1>
                                    <ProjectStatus status={project.status} />
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-charcoal/55">
                                    <span className="flex items-center gap-1.5"><FiBriefcase className="size-4" /> {project.clientName}</span>
                                    {project.category && <span className="flex items-center gap-1.5"><FiTag className="size-4" /> {project.category}</span>}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            {team.length > 0 && (
                                <div className="flex items-center">
                                    <div className="flex -space-x-2">
                                        {team.slice(0, 4).map(member => (
                                            <span key={member._id} title={member.name} className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-blue-50 text-xs font-bold text-blue-600">
                                                {member.name?.charAt(0).toUpperCase() || '?'}
                                            </span>
                                        ))}
                                        {team.length > 4 && (
                                            <span className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-charcoal/[0.06] text-xs font-bold text-charcoal/60">+{team.length - 4}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            <button onClick={openEdit} className="flex items-center justify-center gap-2 rounded-xl border border-charcoal/10 bg-white px-4 py-2.5 text-sm font-medium text-charcoal transition hover:bg-charcoal/[0.03]">
                                <FiEdit className="size-4" /> Edit Project
                            </button>
                        </div>
                    </div>

                    {/* Schedule */}
                    <div className="mt-6 border-t border-charcoal/5 pt-5">
                        {timeline ? (
                            <>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-charcoal/55">
                                    <span>Started {formatDay(project.startDate)}</span>
                                    <span className={`font-semibold ${timeline.days < 0 && project.status !== 'Completed' ? 'text-red-600' : 'text-charcoal'}`}>
                                        {scheduleLabel(project, timeline.days)}
                                    </span>
                                    <span>Deadline {formatDay(project.deadline)}</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-charcoal/10">
                                    <div
                                        className={`h-full rounded-full transition-all ${project.status === 'Completed' ? 'bg-emerald-500' : timeline.days < 0 ? 'bg-red-500' : 'bg-blue-500'}`}
                                        style={{ width: `${project.status === 'Completed' ? 100 : timeline.percent}%` }}
                                    />
                                </div>
                            </>
                        ) : (
                            <p className="text-xs text-charcoal/50">Started {formatDay(project.startDate)} - no deadline set.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Key numbers */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard title="Project Budget" value={formatMoney(project.budget)} icon={<FiDollarSign />} />
                <ProjectExpenseStat projectId={project._id} />
                <StatCard
                    title="Milestones"
                    value={summary ? `${summary.completed}/${summary.total}` : '-'}
                    subtitle={summary ? (summary.overdue > 0 ? `${summary.overdue} overdue` : `${summary.progressPercent}% delivered`) : undefined}
                    icon={<FiCheckCircle />}
                />
                <StatCard title="Team" value={String(team.length)} subtitle={team.length === 1 ? 'employee assigned' : 'employees assigned'} icon={<FiUsers />} />
            </div>

            {/* Tabs */}
            <div className="border-b border-charcoal/10">
                <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Project sections">
                    {tabs.map(t => {
                        const active = tab === t.id
                        return (
                            <button
                                key={t.id}
                                onClick={() => changeTab(t.id)}
                                aria-current={active ? 'page' : undefined}
                                className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${active ? 'border-blue-600 text-blue-600' : 'border-transparent text-charcoal/50 hover:text-charcoal'}`}
                            >
                                {t.icon}
                                {t.label}
                                {t.count !== undefined && (
                                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-blue-50 text-blue-600' : 'bg-charcoal/[0.05] text-charcoal/50'}`}>{t.count}</span>
                                )}
                            </button>
                        )
                    })}
                </nav>
            </div>

            {tab === 'overview' && (
                <ProjectOverview project={project} milestones={milestones.data} onOpenMilestones={() => changeTab('milestones')} />
            )}

            {tab === 'milestones' && (
                <ProjectMilestones
                    projectId={project._id}
                    data={milestones.data}
                    loading={milestones.loading}
                    error={milestones.error}
                    reload={milestones.reload}
                />
            )}

            {tab === 'expenses' && (
                <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <Expenses projectId={project._id} showProject={false} onExpenseChange={loadProject} />
                </div>
            )}

            {tab === 'tasks' && (
                <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <TaskManagment projectId={project._id} />
                </div>
            )}

            <ModalBox open={editOpen} onClose={() => setEditOpen(false)} size="2xl" title="Edit Project">
                <div className="grid gap-5 sm:grid-cols-2">
                    <Input label="Project Name" name="name" required value={form.name} handleChange={handleFormChange} />
                    <Input label="Client / Company" name="clientName" required value={form.clientName} handleChange={handleFormChange} />
                    <Input label="Start Date" name="startDate" type="date" required value={form.startDate} handleChange={handleFormChange} />
                    <Input label="Deadline" name="deadline" type="date" value={form.deadline} handleChange={handleFormChange} />
                    <Input label="Budget" name="budget" type="number" min={0} required value={form.budget} handleChange={handleFormChange} />
                    <Input label="Category" name="category" required value={form.category} handleChange={handleFormChange} />
                    <SelectField
                        label="Status"
                        name="status"
                        value={form.status}
                        onChange={handleFormChange}
                        options={[
                            { value: 'Planning', label: 'Planning' },
                            { value: 'Active', label: 'Active' },
                            { value: 'Completed', label: 'Completed' },
                            { value: 'On Hold', label: 'On Hold' },
                        ]}
                    />
                </div>
                <div className="mt-5">
                    <TextAreaField label="Description" name="description" value={form.description} onChange={handleFormChange} placeholder="Project description..." rows={4} />
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={() => setEditOpen(false)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]">Cancel</button>
                    <ButtonEmerald onClick={handleSave} loading={saving}>Update Project</ButtonEmerald>
                </div>
            </ModalBox>
        </div>
    )
}

// Project expense total, per currency (the API returns totalExpense = null when currencies are mixed)
const ProjectExpenseStat = ({ projectId }: { projectId: string }) => {
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
