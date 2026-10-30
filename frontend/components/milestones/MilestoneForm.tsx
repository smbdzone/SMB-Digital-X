'use client'

import React, { useEffect, useRef, useState } from 'react'
import { FiPlus, FiTrash2 } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
    createMilestone,
    MILESTONE_PAYMENT_OPTIONS,
    MILESTONE_STATUS_OPTIONS,
    updateMilestone,
    type DeliverablePayload,
    type Milestone,
    type MilestonePayload,
    type MilestonePaymentStatus,
    type MilestoneStatus,
    type PaymentMode,
} from '@/services/milestone.services'
import { toDateInput } from '@/lib/formatDay'
import { errorMessage, formatCurrency } from '@/lib/utils'
import ModalBox from '../ui/ModalBox'
import Input from '../ui/Input'
import SelectField from '../ui/SelectField'
import ButtonEmerald from '../ui/ButtonEmerald'
import { TextAreaField } from '../ui/shared'

interface Props {
    open: boolean
    onClose: () => void
    projectId: string
    milestone?: Milestone | null // set = edit mode
    budget: number
    defaultCurrency: string
    remainingPercent: number // % of the budget still free for this milestone
    onSaved: () => void
}

interface DeliverableRow {
    key: number
    _id?: string
    title: string
    description: string
    isDone: boolean
}

interface FormState {
    title: string
    description: string
    startDate: string
    deadline: string
    paymentMode: PaymentMode
    paymentValue: string
    currency: string
    status: MilestoneStatus
    paymentStatus: MilestonePaymentStatus
    notes: string
}

const emptyForm = (currency: string): FormState => ({
    title: '',
    description: '',
    startDate: '',
    deadline: '',
    paymentMode: 'percentage',
    paymentValue: '',
    currency,
    status: 'pending',
    paymentStatus: 'unpaid',
    notes: '',
})

const MilestoneForm = ({ open, onClose, projectId, milestone, budget, defaultCurrency, remainingPercent, onSaved }: Props) => {
    const { token } = useAuth()
    const toast = useToast()
    const keyCounter = useRef(0)
    const nextKey = () => ++keyCounter.current

    const [form, setForm] = useState<FormState>(emptyForm(defaultCurrency))
    const [deliverables, setDeliverables] = useState<DeliverableRow[]>([])
    const [saving, setSaving] = useState(false)
    const isEdit = !!milestone

    useEffect(() => {
        if (!open) return
        if (milestone) {
            setForm({
                title: milestone.title,
                description: milestone.description ?? '',
                startDate: toDateInput(milestone.startDate),
                deadline: toDateInput(milestone.deadline),
                paymentMode: milestone.paymentMode,
                paymentValue: String(milestone.paymentMode === 'amount' ? milestone.paymentAmount : milestone.paymentPercentage),
                currency: milestone.currency || defaultCurrency,
                status: milestone.status,
                paymentStatus: milestone.paymentStatus,
                notes: milestone.notes ?? '',
            })
            setDeliverables(milestone.deliverables.map(d => ({
                key: nextKey(),
                _id: d._id,
                title: d.title,
                description: d.description ?? '',
                isDone: d.isDone,
            })))
        } else {
            setForm(emptyForm(defaultCurrency))
            setDeliverables([])
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, milestone])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const updateRow = (key: number, patch: Partial<DeliverableRow>) =>
        setDeliverables(rows => rows.map(r => (r.key === key ? { ...r, ...patch } : r)))

    // What the typed payment value means in the other unit, for the helper text.
    const paymentHint = () => {
        const value = Number(form.paymentValue)
        if (form.paymentValue === '' || !Number.isFinite(value)) return `Up to ${Math.round(remainingPercent * 100) / 100}% of the project budget is still available.`
        if (budget <= 0) return 'The project budget is 0. Set a budget on the project to calculate payment amounts.'
        if (form.paymentMode === 'percentage') return `= ${formatCurrency(Math.round(budget * value) / 100, form.currency)} of the ${formatCurrency(budget)} budget. Available: ${Math.round(remainingPercent * 100) / 100}%.`
        return `= ${Math.round((value / budget) * 10000) / 100}% of the ${formatCurrency(budget)} budget. Available: ${Math.round(remainingPercent * 100) / 100}%.`
    }

    const handleSubmit = async () => {
        if (!token) return

        if (!form.title.trim()) return toast.showError('Milestone title is required')
        if (form.startDate && form.deadline && form.deadline < form.startDate) {
            return toast.showError('Deadline cannot be before the start date')
        }
        if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return toast.showError('Currency must be a 3-letter code, for example AED')

        let payment: Pick<MilestonePayload, 'paymentPercentage' | 'paymentAmount'> = {}
        if (form.paymentValue !== '') {
            const value = Number(form.paymentValue)
            if (!Number.isFinite(value) || value < 0) return toast.showError('Payment must be a number of 0 or more')
            if (form.paymentMode === 'percentage') {
                if (value > 100) return toast.showError('Payment percentage cannot be more than 100')
                payment = { paymentPercentage: value }
            } else {
                payment = { paymentAmount: value }
            }
        }

        const items: DeliverablePayload[] = deliverables
            .filter(d => d.title.trim())
            .map(d => ({
                ...(d._id ? { _id: d._id, isDone: d.isDone } : {}),
                title: d.title.trim(),
                ...(d.description.trim() ? { description: d.description.trim() } : {}),
            }))

        const payload: MilestonePayload = {
            title: form.title.trim(),
            description: form.description.trim(),
            notes: form.notes.trim(),
            currency: form.currency.trim().toUpperCase(),
            status: form.status,
            paymentStatus: form.paymentStatus,
            deliverables: items,
            ...payment,
        }

        if (isEdit) {
            payload.startDate = form.startDate || null // null clears the date
            payload.deadline = form.deadline || null
        } else {
            if (form.startDate) payload.startDate = form.startDate
            if (form.deadline) payload.deadline = form.deadline
        }

        setSaving(true)
        try {
            const res = isEdit
                ? await updateMilestone(token, milestone!._id, payload)
                : await createMilestone(token, projectId, payload)
            toast.showSuccess(res.message || (isEdit ? 'Milestone updated' : 'Milestone added'))
            onSaved()
            onClose()
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to save milestone'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <ModalBox open={open} onClose={onClose} size="2xl" title={isEdit ? 'Edit milestone' : 'Add milestone'}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Title" name="title" required value={form.title} handleChange={handleChange} maxLength={150} placeholder="Design approval" containerClassName="sm:col-span-2" />
                <div className="sm:col-span-2">
                    <TextAreaField label="Description" name="description" value={form.description} onChange={handleChange} placeholder="UI/UX screens signed off by client" rows={3} />
                </div>
                <Input label="Start date" name="startDate" type="date" value={form.startDate} handleChange={handleChange} />
                <Input label="Deadline" name="deadline" type="date" value={form.deadline} handleChange={handleChange} />
            </div>

            {/* Payment */}
            <div className="mt-6 border-t border-charcoal/5 pt-5">
                <h5 className="text-sm font-semibold text-charcoal">Payment</h5>
                <p className="mt-0.5 text-xs text-charcoal/50">Enter a percentage or an amount. The other one is calculated from the project budget.</p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <SelectField
                        label="Enter payment as"
                        value={form.paymentMode}
                        onChange={e => setForm(p => ({ ...p, paymentMode: e.target.value as PaymentMode, paymentValue: '' }))}
                        options={[{ value: 'percentage', label: 'Percentage of budget' }, { value: 'amount', label: 'Fixed amount' }]}
                    />
                    <Input
                        label={form.paymentMode === 'percentage' ? 'Percentage (%)' : 'Amount'}
                        name="paymentValue"
                        type="number"
                        min={0}
                        max={form.paymentMode === 'percentage' ? 100 : undefined}
                        value={form.paymentValue}
                        handleChange={handleChange}
                        placeholder={form.paymentMode === 'percentage' ? '30' : '5000'}
                        helperText={paymentHint()}
                    />
                    <Input
                        label="Currency"
                        name="currency"
                        maxLength={3}
                        value={form.currency}
                        handleChange={e => setForm(p => ({ ...p, currency: e.target.value.toUpperCase() }))}
                    />
                    <SelectField label="Payment status" name="paymentStatus" value={form.paymentStatus} onChange={handleChange} options={MILESTONE_PAYMENT_OPTIONS} />
                    <SelectField label="Milestone status" name="status" value={form.status} onChange={handleChange} options={MILESTONE_STATUS_OPTIONS} />
                </div>
            </div>

            {/* Deliverables */}
            <div className="mt-6 border-t border-charcoal/5 pt-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h5 className="text-sm font-semibold text-charcoal">Deliverables</h5>
                        <p className="mt-0.5 text-xs text-charcoal/50">Things that must be delivered for this milestone. Rows without a title are ignored.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDeliverables(rows => [...rows, { key: nextKey(), title: '', description: '', isDone: false }])}
                        className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
                    >
                        <FiPlus className="size-4" /> Add
                    </button>
                </div>
                {deliverables.length === 0 ? (
                    <p className="mt-3 text-sm text-charcoal/40">No deliverables added.</p>
                ) : (
                    <div className="mt-4 space-y-3">
                        {deliverables.map(row => (
                            <div key={row.key} className="grid grid-cols-1 gap-3 rounded-xl border border-charcoal/5 bg-charcoal/[0.02] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                                <Input value={row.title} handleChange={e => updateRow(row.key, { title: e.target.value })} maxLength={200} placeholder="Figma designs" aria-label="Deliverable title" />
                                <Input value={row.description} handleChange={e => updateRow(row.key, { description: e.target.value })} maxLength={1000} placeholder="Details (optional)" aria-label="Deliverable details" />
                                <button
                                    type="button"
                                    onClick={() => setDeliverables(rows => rows.filter(r => r.key !== row.key))}
                                    className="flex size-9 items-center justify-center justify-self-end rounded-lg text-red-500 transition hover:bg-red-50"
                                    title="Remove deliverable"
                                >
                                    <FiTrash2 className="size-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-6">
                <TextAreaField label="Notes" name="notes" value={form.notes} onChange={handleChange} placeholder="Internal notes (optional)" rows={2} />
            </div>

            <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={onClose} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]">Cancel</button>
                <ButtonEmerald onClick={handleSubmit} loading={saving}>{isEdit ? 'Save changes' : 'Add milestone'}</ButtonEmerald>
            </div>
        </ModalBox>
    )
}

export default MilestoneForm
