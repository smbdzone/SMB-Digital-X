'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    createHistoryEntry,
    fetchHistoryTypes,
    HISTORY_TYPE_OPTIONS,
    updateHistoryEntry,
    type HistoryEntry,
    type HistoryPayload,
    type HistoryType,
    type HistoryTypeOption,
} from '@/services/employeeHistory.services'
import { toDateInput } from '@/lib/formatDay'
import { errorMessage, getTodayDate } from '@/lib/utils'
import ModalBox from '../ui/ModalBox'
import Input from '../ui/Input'
import SelectField from '../ui/SelectField'
import ButtonEmerald from '../ui/ButtonEmerald'
import { TextAreaField } from '../ui/shared'

interface Props {
    open: boolean
    onClose: () => void
    employeeId: string
    entry?: HistoryEntry | null // set = edit mode
    onSaved: () => void
}

interface FormState {
    type: HistoryType
    title: string
    description: string
    effectiveDate: string
    fromPosition: string
    toPosition: string
    fromSalary: string
    toSalary: string
    currency: string
    applyToProfile: boolean
}

const emptyForm = (): FormState => ({
    type: 'promotion',
    title: '',
    description: '',
    effectiveDate: getTodayDate(),
    fromPosition: '',
    toPosition: '',
    fromSalary: '',
    toSalary: '',
    currency: '',
    applyToProfile: false,
})

const HistoryEntryForm = ({ open, onClose, employeeId, entry, onSaved }: Props) => {
    const { token } = useAuth()
    const toast = useToast()
    const [form, setForm] = useState<FormState>(emptyForm)
    const [types, setTypes] = useState<HistoryTypeOption[]>(HISTORY_TYPE_OPTIONS)
    const [saving, setSaving] = useState(false)
    const isEdit = !!entry

    // Event types come from the server so the dropdown always matches the backend.
    useEffect(() => {
        if (!open || !token) return
        let cancelled = false
        fetchHistoryTypes(token)
            .then(res => { if (!cancelled && res.data?.length) setTypes(res.data) })
            .catch(() => { /* keep the built-in list */ })
        return () => { cancelled = true }
    }, [open, token])

    // Fill the form each time the modal opens.
    useEffect(() => {
        if (!open) return
        if (entry) {
            setForm({
                type: entry.type,
                title: entry.title ?? '',
                description: entry.description ?? '',
                effectiveDate: toDateInput(entry.effectiveDate),
                fromPosition: entry.fromPosition ?? '',
                toPosition: entry.toPosition ?? '',
                fromSalary: entry.fromSalary !== undefined && entry.fromSalary !== null ? String(entry.fromSalary) : '',
                toSalary: entry.toSalary !== undefined && entry.toSalary !== null ? String(entry.toSalary) : '',
                currency: entry.currency ?? '',
                applyToProfile: false,
            })
        } else {
            setForm(emptyForm())
        }
    }, [open, entry])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async () => {
        if (!token) return

        if (!form.effectiveDate) return toast.showError('Effective date is required')
        if (isEdit && !form.title.trim()) return toast.showError('Title cannot be empty')
        for (const [label, value] of [['From salary', form.fromSalary], ['To salary', form.toSalary]] as const) {
            if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
                return toast.showError(`${label} must be a number of 0 or more`)
            }
        }
        if (form.currency.trim() && !/^[A-Za-z]{3}$/.test(form.currency.trim())) {
            return toast.showError('Currency must be a 3-letter code, for example AED')
        }
        if (!isEdit && form.applyToProfile && !form.toPosition.trim() && form.toSalary === '') {
            return toast.showError('To update the profile, enter a new position and/or a new salary')
        }

        const payload: HistoryPayload = {
            type: form.type,
            effectiveDate: form.effectiveDate,
        }

        if (isEdit) {
            // On edit, empty text clears the field. Salaries cannot be cleared (the backend ignores empty ones).
            payload.title = form.title.trim()
            payload.description = form.description.trim()
            payload.fromPosition = form.fromPosition.trim()
            payload.toPosition = form.toPosition.trim()
        } else {
            if (form.title.trim()) payload.title = form.title.trim() // blank = backend uses the type name
            if (form.description.trim()) payload.description = form.description.trim()
            if (form.fromPosition.trim()) payload.fromPosition = form.fromPosition.trim()
            if (form.toPosition.trim()) payload.toPosition = form.toPosition.trim()
            if (form.applyToProfile) payload.applyToProfile = true
        }
        if (form.fromSalary !== '') payload.fromSalary = Number(form.fromSalary)
        if (form.toSalary !== '') payload.toSalary = Number(form.toSalary)
        if (form.currency.trim()) payload.currency = form.currency.trim().toUpperCase()

        setSaving(true)
        try {
            const res = isEdit
                ? await updateHistoryEntry(token, entry!._id, payload)
                : await createHistoryEntry(token, employeeId, payload)
            toast.showSuccess(res.message || (isEdit ? 'History entry updated' : 'History entry added'))
            onSaved()
            onClose()
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to save history entry'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <ModalBox open={open} onClose={onClose} size="2xl" title={isEdit ? 'Edit history entry' : 'Add history entry'}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                    label="Event type"
                    name="type"
                    required
                    value={form.type}
                    onChange={handleChange}
                    options={types.map(t => ({ value: t.value, label: t.label }))}
                />
                <Input label="Effective date" name="effectiveDate" type="date" required value={form.effectiveDate} handleChange={handleChange} />
                <Input
                    label="Title"
                    name="title"
                    required={isEdit}
                    value={form.title}
                    handleChange={handleChange}
                    maxLength={150}
                    placeholder="Promoted to Junior Developer"
                    helperText={isEdit ? undefined : 'Leave blank to use the event type as the title.'}
                    containerClassName="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                    <TextAreaField
                        label="Description"
                        name="description"
                        value={form.description}
                        onChange={handleChange}
                        placeholder="Completed internship with excellent feedback"
                        rows={3}
                    />
                </div>
            </div>

            <div className="mt-6 border-t border-charcoal/5 pt-5">
                <h5 className="text-sm font-semibold text-charcoal">Position and salary change</h5>
                <p className="mt-0.5 text-xs text-charcoal/50">
                    Optional. {isEdit ? '' : 'If you leave the "From" values blank and update the profile below, the current profile values are used.'}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input label="From position" name="fromPosition" value={form.fromPosition} handleChange={handleChange} maxLength={100} placeholder="Intern" />
                    <Input label="To position" name="toPosition" value={form.toPosition} handleChange={handleChange} maxLength={100} placeholder="Junior Developer" />
                    <Input label="From salary" name="fromSalary" type="number" min={0} value={form.fromSalary} handleChange={handleChange} placeholder="2000" />
                    <Input label="To salary" name="toSalary" type="number" min={0} value={form.toSalary} handleChange={handleChange} placeholder="4500" />
                    <Input
                        label="Currency"
                        name="currency"
                        maxLength={3}
                        value={form.currency}
                        handleChange={e => setForm(p => ({ ...p, currency: e.target.value.toUpperCase() }))}
                        placeholder="AED"
                    />
                </div>
            </div>

            {isEdit ? (
                <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Editing changes this record only. The employee&apos;s current position and salary are not changed.
                </div>
            ) : (
                <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-charcoal/10 bg-charcoal/[0.02] p-4">
                    <input
                        type="checkbox"
                        checked={form.applyToProfile}
                        onChange={e => setForm(p => ({ ...p, applyToProfile: e.target.checked }))}
                        className="mt-0.5 size-4 accent-blue-600"
                    />
                    <span className="text-sm">
                        <span className="block font-medium text-charcoal">Also update the employee&apos;s profile</span>
                        <span className="mt-0.5 block text-xs text-charcoal/50">
                            Sets the current position and/or salary from the &quot;To&quot; values. The old salary is kept in salary history.
                            Leave this off to only record the event.
                        </span>
                    </span>
                </label>
            )}

            <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={onClose} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]">Cancel</button>
                <ButtonEmerald onClick={handleSubmit} loading={saving}>{isEdit ? 'Save changes' : 'Add entry'}</ButtonEmerald>
            </div>
        </ModalBox>
    )
}

export default HistoryEntryForm
