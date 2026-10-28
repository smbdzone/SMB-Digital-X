'use client'

import React, { useEffect, useState } from 'react'
import { FiPlus, FiEdit, FiTrash2, FiEye, FiCalendar, FiDollarSign } from 'react-icons/fi'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { createProject, deleteProject, fetchProjects, updateProject, Project } from '@/services/project.services'
import ButtonEmerald from '../ui/ButtonEmerald'
import ModalBox from '../ui/ModalBox'
import Input from '../ui/Input'
import { ProjectStatus } from '@/components/ui/shared'

const Projects = () => {
    const toast = useToast()
    const { token } = useAuth()
    const router = useRouter()
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [modalOpen, setModalOpen] = useState(false)
    const [editProjectId, setEditProjectId] = useState('')

    const [form, setForm] = useState({
        name: '', clientName: '', description: '', startDate: '', deadline: '', budget: '', category: '', status: 'Planning'
    })

    useEffect(() => {
        fetchProjectList()
    }, [])

    const fetchProjectList = async () => {
        if (!token) return
        setLoading(true)
        setError(null)
        try {
            const response = await fetchProjects(token)
            if (response.success) {
                setProjects(response.data ?? [])
            } else {
                setError(response.message || 'Failed to fetch projects')
                toast.showError(response.message || 'Failed to fetch projects')
            }
        } catch (error) {
            console.error(error)
            setError('Failed to fetch projects')
            toast.showError('Failed to fetch projects')
        } finally {
            setLoading(false)
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const resetForm = () => {
        setForm({ name: '', clientName: '', description: '', startDate: '', deadline: '', budget: '', category: '', status: 'Planning' })
        setEditProjectId('')
    }

    const openAddModal = () => {
        resetForm()
        setModalOpen(true)
    }

    const openEditModal = (project: Project) => {
        setEditProjectId(project._id)
        setForm({
            name: project.name,
            clientName: project.clientName,
            description: project.description || '',
            startDate: project.startDate ? project.startDate.slice(0, 10) : '',
            deadline: project.deadline ? project.deadline.slice(0, 10) : '',
            budget: String(project.budget),
            category: project.category,
            status: project.status
        })
        setModalOpen(true)
    }

    const closeModal = () => {
        setModalOpen(false)
        resetForm()
    }

    const handleSubmit = async () => {
        if (!token) return
        if (!form.name.trim() || !form.clientName.trim() || !form.category.trim() || !form.startDate) {
            toast.showError('Please fill all required fields')
            return
        }
        if (!form.budget || Number(form.budget) < 0) {
            toast.showError('Valid budget is required')
            return
        }

        setLoading(true)
        const payload = {
            name: form.name.trim(),
            clientName: form.clientName.trim(),
            description: form.description.trim(),
            startDate: form.startDate,
            deadline: form.deadline || undefined,
            budget: Number(form.budget),
            category: form.category,
            status: form.status as Project['status']
        }

        try {
            const response = editProjectId
                ? await updateProject(token, editProjectId, payload)
                : await createProject(token, payload)
            if (response.success) {
                toast.showSuccess(editProjectId ? 'Project updated successfully' : 'Project created successfully')
                closeModal()
                fetchProjectList()
            } else {
                toast.showError(response.message || 'Operation failed')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Something went wrong')
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!token) return
        if (!confirm('Are you sure you want to delete this project?')) return
        setLoading(true)
        try {
            const response = await deleteProject(token, id)
            if (response.success) {
                toast.showSuccess('Project deleted successfully')
                fetchProjectList()
            } else {
                toast.showError(response.message || 'Failed to delete project')
            }
        } catch (error) {
            console.error(error)
            toast.showError('Failed to delete project')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div className="flex items-center justify-between py-4 lg:py-6">
                <div>
                    <h4 className="text-md font-bold font-heading sm:text-xl">Projects</h4>
                    <p className="mt-1 text-sm text-charcoal/50">Manage your projects and project expenses.</p>
                </div>
                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAddModal}>Add Project</ButtonEmerald>
            </div>

            {loading && !projects.length ? (
                <div className="rounded-xl bg-white p-10 text-center text-sm text-charcoal/50 shadow">Loading projects...</div>
            ) : error ? (
                <div className="rounded-xl bg-white p-10 text-center text-sm text-red-500 shadow">{error}</div>
            ) : projects.length === 0 ? (
                <div className="rounded-xl bg-white p-12 text-center shadow">
                    <h3 className="font-semibold text-charcoal">No projects yet</h3>
                    <p className="mt-1 text-sm text-charcoal/50">Create your first project to get started.</p>
                    <div className="mt-5"><ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAddModal}>Add Project</ButtonEmerald></div>
                </div>
            ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {projects.map(project => (
                        <div key={project._id} className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="font-semibold text-charcoal">{project.name}</h3>
                                    <p className="mt-1 text-sm text-charcoal/50">{project.clientName}</p>
                                </div>
                                <ProjectStatus status={project.status} />
                            </div>
                            {project.description && <p className="mt-4 line-clamp-2 text-sm leading-6 text-charcoal/60">{project.description}</p>}
                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-charcoal/[0.03] p-3">
                                    <div className="flex items-center gap-2 text-xs text-charcoal/50"><FiDollarSign /> Budget</div>
                                    <p className="mt-1 font-semibold">{project.budget.toLocaleString()}</p>
                                </div>
                                <div className="rounded-xl bg-charcoal/[0.03] p-3">
                                    <div className="flex items-center gap-2 text-xs text-charcoal/50"><FiCalendar /> Deadline</div>
                                    <p className="mt-1 text-sm font-semibold">{project.deadline ? new Date(project.deadline).toLocaleDateString() : 'No deadline'}</p>
                                </div>
                            </div>
                            <div className="mt-5 flex items-center justify-between border-t border-charcoal/5 pt-4">
                                <span className="text-xs text-charcoal/50">{project.employees?.length || 0} employee{(project.employees?.length || 0) !== 1 ? 's' : ''}</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => router.push(`/projects/${project._id}`)} className="text-blue-600 transition hover:text-blue-800" title="View"><FiEye className="size-4" /></button>
                                    <button onClick={() => openEditModal(project)} className="text-blue-600 transition hover:text-blue-800" title="Edit"><FiEdit className="size-4" /></button>
                                    <button onClick={() => handleDelete(project._id)} className="text-red-500 transition hover:text-red-700" title="Delete"><FiTrash2 className="size-4" /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ModalBox open={modalOpen} onClose={closeModal} size="2xl" title={editProjectId ? 'Edit Project' : 'Add Project'}>
                <div className="grid gap-5 sm:grid-cols-2">
                    <Input label="Project Name" name="name" value={form.name} handleChange={handleChange} placeholder="Website Development" />
                    <Input label="Client / Company" name="clientName" value={form.clientName} handleChange={handleChange} placeholder="ABC Company" />
                    <Input label="Start Date" name="startDate" type="date" value={form.startDate} handleChange={handleChange} />
                    <Input label="Deadline" name="deadline" type="date" value={form.deadline} handleChange={handleChange} />
                    <Input label="Budget" name="budget" type="number" value={form.budget} handleChange={handleChange} placeholder="5000" />
                    <Input label="Category" name="category" type="text" value={form.category} handleChange={handleChange} placeholder="Web Development" />
                    <div>
                        <label className="mb-2 block text-sm font-medium text-charcoal">Status</label>
                        <select name="status" value={form.status} onChange={handleChange} className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm text-charcoal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                            <option value="Planning">Planning</option>
                            <option value="Active">Active</option>
                            <option value="Completed">Completed</option>
                            <option value="On Hold">On Hold</option>
                        </select>
                    </div>
                </div>
                <div className="mt-5">
                    <label className="mb-2 block text-sm font-medium text-charcoal">Description</label>
                    <textarea name="description" value={form.description} onChange={handleChange} rows={4} placeholder="Project description..." className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm text-charcoal outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </div>
                <div className="mt-6 flex justify-end">
                    <ButtonEmerald onClick={handleSubmit} disabled={loading}>{editProjectId ? 'Update Project' : 'Create Project'}</ButtonEmerald>
                </div>
            </ModalBox>
        </>
    )
}

export default Projects