'use client'

import React from 'react'
import { FiBriefcase, FiCalendar, FiCheckSquare, FiDollarSign, FiFlag, FiTag } from 'react-icons/fi'
import type { Project } from '@/services/project.services'
import type { MilestoneListResponse } from '@/services/milestone.services'
import { formatDay } from '@/lib/formatDay'
import { formatCurrency, formatMoney } from '@/lib/utils'
import { ProjectStatus } from '@/components/ui/shared'

interface Props {
    project: Project
    milestones: MilestoneListResponse | null
    onOpenMilestones: () => void
}

const Detail = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-charcoal/[0.04] text-charcoal/50">{icon}</div>
        <div className="min-w-0">
            <p className="text-xs text-charcoal/45">{label}</p>
            <div className="mt-0.5 text-sm font-semibold text-charcoal">{children}</div>
        </div>
    </div>
)

const ProjectOverview = ({ project, milestones, onOpenMilestones }: Props) => {
    const team = project.employees ?? []
    const next = milestones?.data.find(m => m.status !== 'completed')

    return (
        <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
                <section className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <h3 className="font-heading text-base font-bold text-charcoal">About this project</h3>
                    <p className="mt-3 text-sm leading-6 text-charcoal/60">
                        {project.description || 'No description has been added to this project yet.'}
                    </p>

                    <div className="mt-6 grid gap-5 border-t border-charcoal/5 pt-6 sm:grid-cols-2">
                        <Detail icon={<FiBriefcase className="size-4" />} label="Client">{project.clientName}</Detail>
                        <Detail icon={<FiTag className="size-4" />} label="Category">{project.category || '-'}</Detail>
                        <Detail icon={<FiCalendar className="size-4" />} label="Start date">{formatDay(project.startDate)}</Detail>
                        <Detail icon={<FiFlag className="size-4" />} label="Deadline">{project.deadline ? formatDay(project.deadline) : 'No deadline'}</Detail>
                        <Detail icon={<FiDollarSign className="size-4" />} label="Budget">{formatMoney(project.budget)}</Detail>
                        <Detail icon={<FiCheckSquare className="size-4" />} label="Status"><ProjectStatus status={project.status} /></Detail>
                    </div>
                </section>

                <section className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex items-center justify-between">
                        <h3 className="font-heading text-base font-bold text-charcoal">Next milestone</h3>
                        <button onClick={onOpenMilestones} className="text-sm font-semibold text-blue-600 transition hover:text-blue-700">Open milestones</button>
                    </div>

                    {!milestones ? (
                        <p className="mt-4 text-sm text-charcoal/45">Milestones are loading...</p>
                    ) : milestones.data.length === 0 ? (
                        <div className="mt-4 rounded-xl border border-dashed border-charcoal/10 px-4 py-8 text-center">
                            <p className="text-sm font-semibold text-charcoal">No milestones yet</p>
                            <p className="mt-1 text-sm text-charcoal/45">Split this project into payment stages to track delivery and payments.</p>
                            <button onClick={onOpenMilestones} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700">Plan milestones</button>
                        </div>
                    ) : !next ? (
                        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-700">
                            All {milestones.summary.total} milestones are completed.
                        </div>
                    ) : (
                        <div className="mt-4 rounded-xl border border-charcoal/5 bg-charcoal/[0.02] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-heading text-sm font-bold text-charcoal">{next.title}</p>
                                    <p className={`mt-1 text-xs ${next.isOverdue ? 'font-semibold text-red-600' : 'text-charcoal/50'}`}>
                                        {next.deadline ? `${next.isOverdue ? 'Overdue since' : 'Due'} ${formatDay(next.deadline)}` : 'No deadline set'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-heading text-sm font-bold text-charcoal">{formatCurrency(next.paymentAmount, next.currency)}</p>
                                    <p className="text-xs text-charcoal/45">{next.paymentPercentage}% of budget</p>
                                </div>
                            </div>
                            {next.deliverablesTotal > 0 && (
                                <div className="mt-4">
                                    <div className="mb-1.5 flex justify-between text-xs text-charcoal/50">
                                        <span>Deliverables</span>
                                        <span>{next.deliverablesDone} of {next.deliverablesTotal}</span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-charcoal/10">
                                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(next.deliverablesDone / next.deliverablesTotal) * 100}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            </div>

            <section className="h-fit rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between">
                    <h3 className="font-heading text-base font-bold text-charcoal">Team</h3>
                    <span className="rounded-full bg-charcoal/[0.05] px-2.5 py-1 text-xs font-semibold text-charcoal/60">{team.length}</span>
                </div>
                {team.length === 0 ? (
                    <p className="mt-4 text-sm text-charcoal/45">No employees are assigned to this project.</p>
                ) : (
                    <ul className="mt-4 space-y-3">
                        {team.map(member => (
                            <li key={member._id} className="flex items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
                                    {member.name?.charAt(0).toUpperCase() || '?'}
                                </span>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-charcoal">{member.name}</p>
                                    <p className="truncate text-xs text-charcoal/45">{member.email}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    )
}

export default ProjectOverview
