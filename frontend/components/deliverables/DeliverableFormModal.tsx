'use client'

import React, { useEffect, useState } from 'react'
import { FiSave } from 'react-icons/fi'
import ModalBox from '@/components/ui/ModalBox'
import Input from '@/components/ui/Input'
import SelectField from '@/components/ui/SelectField'
import ButtonEmerald from '@/components/ui/ButtonEmerald'
import { TextAreaField } from '@/components/ui/shared'
import {
    Deliverable, DeliverableInput, DeliverablePriority, PRIORITIES,
} from '@/services/deliverable.services'

interface DeliverableFormModalProps {
    open: boolean
    onClose: () => void
    /** null = add a new item */
    item: Deliverable | null
    projects: { _id: string; name: string }[]
    saving: boolean
    onSave: (payload: DeliverableInput) => void
    title?: string
    description?: string
}

const EMPTY = { title: '', description: '', priority: 'Medium' as DeliverablePriority, estimatedHours: '', projectId: '' }

// Same limits as the backend (deliverable.service.ts)
const TITLE_MAX = 200
const DESCRIPTION_MAX = 2000

const DeliverableFormModal = ({ open, onClose, item, projects, saving, onSave, title, description }: DeliverableFormModalProps) => {
    const [form, setForm] = useState(EMPTY)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!open) return
        setError('')
        setForm(item ? {
            title: item.title,
            description: item.description ?? '',
            priority: item.priority,
            estimatedHours: item.estimatedHours === null || item.estimatedHours === undefined ? '' : String(item.estimatedHours),
            projectId: item.projectId?._id ?? '',
        } : EMPTY)
    }, [open, item])

    const change = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target
        const max = name === 'title' ? TITLE_MAX : name === 'description' ? DESCRIPTION_MAX : undefined
        setForm(prev => ({ ...prev, [name]: max ? value.slice(0, max) : value }))
    }

    const submit = () => {
        const titleText = form.title.trim()
        if (!titleText) return setError('Please enter what you will deliver')
        let estimatedHours: number | null = null
        if (form.estimatedHours !== '') {
            const n = Number(form.estimatedHours)
            if (!Number.isFinite(n) || n < 0 || n > 24) return setError('Estimated hours must be between 0 and 24')
            estimatedHours = n
        }
        setError('')
        onSave({
            title: titleText,
            description: form.description.trim(),
            priority: form.priority,
            estimatedHours,
            projectId: form.projectId || null,
        })
    }

    // A project the employee is no longer on still shows on an existing item
    const projectOptions = [...projects]
    if (item?.projectId && !projects.some(p => p._id === item.projectId?._id)) projectOptions.push(item.projectId)

    return (
        <ModalBox
            open={open}
            onClose={onClose}
            size="lg"
            title={title ?? (item ? 'Edit item' : 'Add item')}
            description={description}
            footer={
                <>
                    <button type="button" onClick={onClose} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                    <ButtonEmerald onClick={submit} loading={saving} icon={<FiSave className="size-4" />}>{item ? 'Save' : 'Add'}</ButtonEmerald>
                </>
            }
        >
            <div className="space-y-4">
                <Input label="What will you deliver?" name="title" required value={form.title} handleChange={change} placeholder="e.g. Finish the login page" />
                <TextAreaField label="Details" name="description" value={form.description} onChange={change} placeholder="Optional" rows={3} />
                <div className="grid grid-cols-2 gap-3">
                    <SelectField
                        label="Priority"
                        name="priority"
                        value={form.priority}
                        onChange={change}
                        options={PRIORITIES.map(p => ({ value: p, label: p }))}
                    />
                    <Input label="Est. hours" name="estimatedHours" type="number" inputMode="decimal" min={0} max={24} step={0.25} value={form.estimatedHours} handleChange={change} placeholder="e.g. 2" />
                </div>
                <SelectField
                    label="Project"
                    name="projectId"
                    value={form.projectId}
                    onChange={change}
                    placeholder="No project"
                    options={projectOptions.map(p => ({ value: p._id, label: p.name }))}
                />
                {error && <p className="text-xs font-medium text-red-500">{error}</p>}
            </div>
        </ModalBox>
    )
}

export default DeliverableFormModal
