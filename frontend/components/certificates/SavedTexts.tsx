'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { FiEdit, FiPlus, FiTrash2 } from 'react-icons/fi'

import ButtonEmerald from '@/components/ui/ButtonEmerald'
import Input from '@/components/ui/Input'
import ModalBox from '@/components/ui/ModalBox'
import SelectField from '@/components/ui/SelectField'
import { StatusBadge } from '@/components/ui/shared'
import { KindBadge } from './Badges'
import WordingFields from './WordingFields'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useCompanies } from '@/hooks/useCompanies'
import {
    CertificateKind,
    CertificateTemplate,
    createCertificateTemplate,
    deleteCertificateTemplate,
    getCertificateTemplates,
    updateCertificateTemplate,
} from '@/services/certificate.services'
import { errorMessage, formatDate } from '@/lib/utils'

const th = 'px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500'

interface TemplateForm {
    typeLabel: string
    kind: CertificateKind
    companyId: string
    title: string
    body: string
}

const emptyForm: TemplateForm = { typeLabel: '', kind: 'letter', companyId: '', title: '', body: '' }

const SavedTexts = () => {
    const { token } = useAuth()
    const toast = useToast()
    const { companies } = useCompanies()

    const [templates, setTemplates] = useState<CertificateTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)

    // null = closed, 'new' = creating, otherwise the text being edited
    const [editing, setEditing] = useState<CertificateTemplate | 'new' | null>(null)
    const [form, setForm] = useState<TemplateForm>(emptyForm)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!token) return
        setLoading(true)
        try {
            const res = await getCertificateTemplates(token, { all: true })
            setTemplates(res.data ?? [])
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load saved texts'))
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    useEffect(() => {
        load()
    }, [load])

    const companyName = (id: string | null) => (id ? companies.find(c => c._id === id)?.name ?? 'Unknown company' : 'All companies')

    const openNew = () => {
        setForm(emptyForm)
        setEditing('new')
    }

    const openEdit = (t: CertificateTemplate) => {
        setForm({ typeLabel: t.typeLabel, kind: t.kind, companyId: t.companyId ?? '', title: t.title, body: t.body })
        setEditing(t)
    }

    const handleSave = async () => {
        if (!token || !editing) return

        if (!form.typeLabel.trim()) return toast.showError('Enter a type name.')
        if (!form.title.trim()) return toast.showError('Add a title.')
        if (!form.body.trim()) return toast.showError('Add the text.')

        setSaving(true)
        try {
            if (editing === 'new') {
                const res = await createCertificateTemplate(token, {
                    type: form.typeLabel.trim(),
                    kind: form.kind,
                    title: form.title.trim(),
                    body: form.body.trim(),
                    companyId: form.companyId || undefined,
                })
                toast.showSuccess(res.message || 'Text saved')
            } else {
                // The type and company of a saved text cannot change (documents already issued point to it).
                const res = await updateCertificateTemplate(token, editing._id, {
                    kind: form.kind,
                    title: form.title.trim(),
                    body: form.body.trim(),
                })
                toast.showSuccess(res.message || 'Saved text updated')
            }
            setEditing(null)
            await load()
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not save the text'))
        } finally {
            setSaving(false)
        }
    }

    const handleToggle = async (t: CertificateTemplate) => {
        if (!token) return
        setBusyId(t._id)
        try {
            await updateCertificateTemplate(token, t._id, { isActive: !t.isActive })
            toast.showSuccess(t.isActive ? 'Switched off. It is no longer offered when issuing.' : 'Switched on')
            await load()
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not update the text'))
        } finally {
            setBusyId(null)
        }
    }

    const handleDelete = async (t: CertificateTemplate) => {
        if (!token) return
        if (!confirm(`Delete the saved text for "${t.typeLabel}"? Documents already issued are not affected.`)) return

        setBusyId(t._id)
        try {
            await deleteCertificateTemplate(token, t._id)
            toast.showSuccess('Saved text deleted')
            await load()
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not delete the text'))
        } finally {
            setBusyId(null)
        }
    }

    const isNew = editing === 'new'

    return (
        <>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-charcoal/50">
                    Wording that is reused each time you issue a type. New wording is also saved automatically when you issue it.
                </p>
                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openNew} className="!h-11 shrink-0">
                    New text
                </ButtonEmerald>
            </div>

            <div className="overflow-x-auto rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className={th}>Type</th>
                            <th className={th}>Layout</th>
                            <th className={th}>Company</th>
                            <th className={th}>Own values</th>
                            <th className={th}>Used</th>
                            <th className={th}>Status</th>
                            <th className={th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading && templates.length === 0 ? (
                            <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : templates.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">
                                    No saved texts yet. Built-in ones such as Joining Letter are available when issuing, and any wording you change is saved here.
                                </td>
                            </tr>
                        ) : (
                            templates.map(t => {
                                const rowBusy = busyId === t._id
                                return (
                                    <tr key={t._id} className={rowBusy ? 'opacity-60' : ''}>
                                        <td className="px-5 py-4">
                                            <p className="font-medium text-gray-900">{t.typeLabel}</p>
                                            <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{t.title}</p>
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4"><KindBadge kind={t.kind} /></td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">{companyName(t.companyId)}</td>
                                        <td className="px-5 py-4 text-xs text-gray-500">
                                            {t.customPlaceholders.length ? t.customPlaceholders.join(', ') : '-'}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
                                            {t.timesUsed}
                                            {t.lastUsedAt && <span className="ml-1 text-xs text-gray-400">(last {formatDate(t.lastUsedAt)})</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <button
                                                onClick={() => handleToggle(t)}
                                                disabled={rowBusy}
                                                title={t.isActive ? 'Click to switch off' : 'Click to switch on'}
                                                className="disabled:opacity-40"
                                            >
                                                <StatusBadge status={t.isActive ? 'active' : 'inactive'} variant="employee" />
                                            </button>
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => openEdit(t)} disabled={rowBusy} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50 disabled:opacity-40" title="Edit"><FiEdit className="size-4" /></button>
                                                <button onClick={() => handleDelete(t)} disabled={rowBusy} className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40" title="Delete"><FiTrash2 className="size-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <ModalBox
                open={!!editing}
                onClose={() => !saving && setEditing(null)}
                size="2xl"
                title={isNew ? 'New saved text' : 'Edit saved text'}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setEditing(null)}
                            disabled={saving}
                            className="inline-flex h-11 items-center rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03] disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <ButtonEmerald onClick={handleSave} loading={saving} className="!h-11">
                            {isNew ? 'Save text' : 'Save changes'}
                        </ButtonEmerald>
                    </>
                }
            >
                <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input
                            label="Type name"
                            required
                            value={form.typeLabel}
                            handleChange={e => setForm(f => ({ ...f, typeLabel: e.target.value }))}
                            placeholder="Appreciation Certificate"
                            maxLength={100}
                            disabled={!isNew}
                            helperText={isNew ? undefined : 'The type cannot be changed. Create a new text instead.'}
                        />
                        <SelectField
                            label="Layout"
                            value={form.kind}
                            onChange={e => setForm(f => ({ ...f, kind: e.target.value as CertificateKind }))}
                            options={[
                                { value: 'letter', label: 'Letter (portrait)' },
                                { value: 'certificate', label: 'Certificate (landscape)' },
                            ]}
                        />
                        <SelectField
                            label="Company"
                            value={form.companyId}
                            onChange={e => setForm(f => ({ ...f, companyId: e.target.value }))}
                            options={companies.map(c => ({ value: c._id, label: c.name }))}
                            placeholder="All companies"
                            disabled={!isNew}
                            helperText={isNew ? undefined : 'The company cannot be changed.'}
                        />
                    </div>

                    <WordingFields
                        title={form.title}
                        body={form.body}
                        onTitleChange={v => setForm(f => ({ ...f, title: v }))}
                        onBodyChange={v => setForm(f => ({ ...f, body: v }))}
                        disabled={saving}
                    />
                </div>
            </ModalBox>
        </>
    )
}

export default SavedTexts
