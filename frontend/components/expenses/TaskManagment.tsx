'use client';

import React, { useEffect, useState } from 'react';
import {
    FiPlus,
    FiEdit,
    FiTrash2,
    FiCalendar,
    FiUser,
    FiFlag,
    FiCheckCircle,
} from 'react-icons/fi';

import ButtonEmerald from '../ui/ButtonEmerald';
import ModalBox from '../ui/ModalBox';
import Input from '../ui/Input';
import { createTask, fetchProjectTasks, updateTask, deleteTask, Task } from '@/services/task.services';
import { fetchAllEmployees } from '@/services/auth.services';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { LoadingSpinner } from '../ui/LoadingSpinner';

interface TaskProps {
    projectId?: string;
}

interface Employee {
    _id: string;
    name: string;
    email: string;
    status: 'active' | 'inactive';
    role?: string;
}

interface TaskForm {
    title: string;
    description: string;
    assignedTo: string;
    priority: string;
    status: string;
    progress: string;
    startDate: string;
    dueDate: string;
    notes: string;
}

const initialForm: TaskForm = {
    title: '',
    description: '',
    assignedTo: '',
    priority: 'Medium',
    status: 'Todo',
    progress: '0',
    startDate: '',
    dueDate: '',
    notes: '',
};

const TaskManagment = ({ projectId }: TaskProps) => {
    const toast = useToast();
    const { token } = useAuth();

    const [tasks, setTasks] = useState<Task[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTaskId, setEditTaskId] = useState('');
    const [form, setForm] = useState<TaskForm>(initialForm);

    useEffect(() => {
        if (projectId && token) {
            loadTasks();
            loadEmployees();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, token]);

    const loadTasks = async () => {
        if (!projectId || !token) return;
        setLoading(true);
        try {
            const response = await fetchProjectTasks(projectId, token);
            if (response.success) {
                setTasks(response.data ?? []);
            } else {
                toast.showError(response.message || 'Failed to fetch tasks');
            }
        } catch (error) {
            console.error(error);
            toast.showError('Failed to fetch tasks');
        } finally {
            setLoading(false);
        }
    };

    const loadEmployees = async () => {
        if (!token) return;
        try {
            const response = await fetchAllEmployees(token);
            if (response.success) {
                //@ts-ignore
                setEmployees((response.data ?? []).filter((emp: any) => emp.status === 'active'));
            }
        } catch (error) {
            console.error(error);
            toast.showError('Failed to fetch employees');
        }
    };

    const handleChangeForm = (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    const resetForm = () => {
        setForm(initialForm);
        setEditTaskId('');
    };

    const openAddModal = () => {
        resetForm();
        setModalOpen(true);
    };

    const openEditModal = (task: Task) => {
        setEditTaskId(task._id);
        const assignedTo = typeof task.assignedTo === 'object' ? task.assignedTo._id : task.assignedTo;
        setForm({
            title: task.title || '',
            description: task.description || '',
            assignedTo,
            priority: task.priority || 'Medium',
            status: task.status || 'Todo',
            progress: String(task.progress ?? 0),
            startDate: formatDateForInput(task.startDate),
            dueDate: formatDateForInput(task.dueDate),
            notes: task.notes || '',
        });
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        resetForm();
    };

    const handleSubmit = async () => {
        if (!token || !projectId) return;
        if (!form.title.trim() || !form.assignedTo) {
            toast.showError('Task title and employee are required');
            return;
        }

        setLoading(true);
        try {
            const progress = Number(form.progress);
            const payload = {
                projectId,
                title: form.title.trim(),
                description: form.description.trim(),
                assignedTo: form.assignedTo,
                priority: form.priority,
                status: progress === 100 ? 'Completed' : form.status,
                progress,
                startDate: form.startDate || undefined,
                dueDate: form.dueDate || undefined,
                notes: form.notes.trim(),
            };

            let response;
            if (editTaskId) {
                response = await updateTask(editTaskId, payload, token);
            } else {
                response = await createTask(payload, token);
            }

            if (response.success) {
                toast.showSuccess(editTaskId ? 'Task updated successfully' : 'Task assigned successfully');
                closeModal();
                loadTasks();
            } else {
                toast.showError(response.message || 'Operation failed');
            }
        } catch (error) {
            console.error(error);
            toast.showError('Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!token) return;
        if (!window.confirm('Are you sure you want to delete this task?')) return;
        setLoading(true);
        try {
            const response = await deleteTask(id, token);
            if (response.success) {
                toast.showSuccess('Task deleted successfully');
                loadTasks();
            } else {
                toast.showError(response.message || 'Failed to delete task');
            }
        } catch (error) {
            console.error(error);
            toast.showError('Failed to delete task');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {/* Header */}
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="font-heading text-lg font-bold">Project Tasks</h3>
                    <p className="mt-1 text-sm text-charcoal/45">
                        Assign and manage work for your employees.
                    </p>
                </div>
                <div>
                    <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openAddModal}>
                        Assign Employee
                    </ButtonEmerald>
                </div>
            </div>

            {/* Tasks */}
            <div className="space-y-3">
                {loading && !tasks.length ? (
                    <div className="flex flex-col items-center justify-center">
                        <LoadingSpinner text="Loading Tasks..." />
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-charcoal/10 bg-white px-5 py-12 text-center">
                        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <FiCheckCircle className="size-5" />
                        </div>
                        <h4 className="mt-4 text-sm font-bold text-charcoal">No tasks assigned</h4>
                        <p className="mx-auto mt-1 max-w-sm text-xs text-charcoal/40">
                            Create a task and assign it to an employee to start tracking project progress.
                        </p>
                        <button
                            onClick={openAddModal}
                            className="mt-5 text-sm font-semibold text-blue-600 hover:text-blue-700"
                        >
                            + Assign your first task
                        </button>
                    </div>
                ) : (
                    tasks.map((task) => (
                        <TaskCard key={task._id} task={task} onEdit={openEditModal} onDelete={handleDelete} />
                    ))
                )}
            </div>

            {/* Modal */}
            {modalOpen && (
                <ModalBox
                    open={modalOpen}
                    onClose={closeModal}
                    size="2xl"
                    title={editTaskId ? 'Edit Task' : 'Assign Task'}
                >
                    <div className="space-y-5">
                        <Input
                            label="Task Title"
                            name="title"
                            placeholder="e.g. Build authentication"
                            value={form.title}
                            handleChange={handleChangeForm}
                            required
                        />

                        <div>
                            <label className="mb-2 block text-sm font-medium text-charcoal">Description</label>
                            <textarea
                                name="description"
                                value={form.description}
                                onChange={handleChangeForm}
                                placeholder="Describe what needs to be completed..."
                                rows={3}
                                className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm text-charcoal outline-none transition-all placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            <SelectField
                                label="Assign Employee"
                                name="assignedTo"
                                value={form.assignedTo}
                                onChange={handleChangeForm}
                            >
                                <option value="">Select employee</option>
                                {employees.map((emp) => (
                                    <option key={emp._id} value={emp._id}>
                                        {emp.name}
                                    </option>
                                ))}
                            </SelectField>
                            <SelectField label="Priority" name="priority" value={form.priority} onChange={handleChangeForm}>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                                <option value="Urgent">Urgent</option>
                            </SelectField>
                        </div>

                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            <SelectField label="Status" name="status" value={form.status} onChange={handleChangeForm}>
                                <option value="Todo">Todo</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Review">Review</option>
                                <option value="Completed">Completed</option>
                            </SelectField>
                            <Input
                                label="Progress (%)"
                                name="progress"
                                type="number"
                                min="0"
                                max="100"
                                value={form.progress}
                                handleChange={handleChangeForm}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                            <Input
                                label="Start Date"
                                name="startDate"
                                type="date"
                                value={form.startDate}
                                handleChange={handleChangeForm}
                            />
                            <Input
                                label="Due Date"
                                name="dueDate"
                                type="date"
                                value={form.dueDate}
                                handleChange={handleChangeForm}
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-medium text-charcoal">Notes</label>
                            <textarea
                                name="notes"
                                value={form.notes}
                                onChange={handleChangeForm}
                                placeholder="Additional notes..."
                                rows={2}
                                className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm text-charcoal outline-none transition-all placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>

                        <div className="flex justify-end gap-3 border-t border-charcoal/5 pt-5">
                            <button
                                type="button"
                                onClick={closeModal}
                                className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal/60 transition hover:bg-charcoal/5"
                            >
                                Cancel
                            </button>
                            <ButtonEmerald onClick={handleSubmit} disabled={loading}>
                                {editTaskId ? 'Update Task' : 'Assign Task'}
                            </ButtonEmerald>
                        </div>
                    </div>
                </ModalBox>
            )}
        </>
    );
};

export default TaskManagment;


interface TaskCardProps {
    task: Task;
    onEdit: (task: Task) => void;
    onDelete: (id: string) => void;
}

const TaskCard = ({ task, onEdit, onDelete }: TaskCardProps) => {
    const employee = typeof task.assignedTo === 'object' ? task.assignedTo : null;

    return (
        <div className="rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-heading text-sm font-bold text-charcoal sm:text-base">{task.title}</h4>
                        <PriorityBadge priority={task.priority} />
                    </div>
                    {task.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-charcoal/45">{task.description}</p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button
                        onClick={() => onEdit(task)}
                        className="rounded-lg p-2 text-blue-500 transition hover:bg-blue-50"
                        title="Edit task"
                    >
                        <FiEdit className="size-4" />
                    </button>
                    <button
                        onClick={() => onDelete(task._id)}
                        className="rounded-lg p-2 text-red-500 transition hover:bg-red-50"
                        title="Delete task"
                    >
                        <FiTrash2 className="size-4" />
                    </button>
                </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-2 text-xs text-charcoal/50">
                    <FiUser className="size-4 text-charcoal/30" />
                    <span>{employee?.name || 'Unknown employee'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-charcoal/50">
                    <FiCalendar className="size-4 text-charcoal/30" />
                    <span>{task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No deadline'}</span>
                </div>
                <StatusBadge status={task.status} />
            </div>

            <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-charcoal/50">Progress</span>
                    </div>
                    <span className="text-xs font-bold text-charcoal">{task.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-charcoal/5">
                    <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(Math.max(task.progress, 0), 100)}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

const StatusBadge = ({ status }: { status: Task['status'] }) => {
    const styles: Record<string, string> = {
        Todo: 'bg-gray-100 text-gray-600',
        'In Progress': 'bg-blue-50 text-blue-600',
        Review: 'bg-amber-50 text-amber-600',
        Completed: 'bg-emerald-50 text-emerald-600',
    };
    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}>
            {status}
        </span>
    );
};

const PriorityBadge = ({ priority }: { priority: Task['priority'] }) => {
    const styles: Record<string, string> = {
        Low: 'bg-gray-100 text-gray-500',
        Medium: 'bg-blue-50 text-blue-600',
        High: 'bg-orange-50 text-orange-600',
        Urgent: 'bg-red-50 text-red-600',
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[priority]}`}>
            <FiFlag className="size-3" />
            {priority}
        </span>
    );
};

interface SelectFieldProps {
    label: string;
    name: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    children: React.ReactNode;
}

const SelectField = ({ label, name, value, onChange, children }: SelectFieldProps) => (
    <div className="w-full">
        <label className="mb-2 block text-sm font-medium text-charcoal">{label}</label>
        <select
            name={name}
            value={value}
            onChange={onChange}
            className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm text-charcoal outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
        >
            {children}
        </select>
    </div>
);

const formatDate = (date?: string) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
};

const formatDateForInput = (date?: string) => {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
};