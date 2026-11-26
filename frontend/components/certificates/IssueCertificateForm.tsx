'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { FiEye, FiSearch, FiSend } from 'react-icons/fi'

import ButtonEmerald from '@/components/ui/ButtonEmerald'
import Input from '@/components/ui/Input'
import ModalBox from '@/components/ui/ModalBox'
import SelectField from '@/components/ui/SelectField'
import { StatusBadge } from '@/components/ui/shared'
import CertificateDocument from './CertificateDocument'
import SignaturePicker, { PickedSignature } from './SignaturePicker'
import WordingFields from './WordingFields'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useCompanies } from '@/hooks/useCompanies'
import { fetchAllEmployees, type User } from '@/services/auth.services'
import {
    BulkIssueResult,
    CertificateKind,
    CertificatePreview,
    CertificateType,
    IssuePayload,
    bulkIssueCertificates,
    brokenPlaceholderMessage,
    getCertificateTypes,
    humanizeVariable,
    isAutoVariable,
    issueCertificate,
    legacyNames,
    parseMissingVariables,
    previewCertificate,
    previewCertificatePdf,
    scanPlaceholders,
} from '@/services/certificate.services'
import { errorMessage } from '@/lib/utils'

const CUSTOM = '__custom__'
const MAX_BULK = 50

const typeKey = (t: CertificateType) => t.templateId ?? `default:${t.typeKey}`

const card = 'rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm'
const cardTitle = 'mb-4 font-heading text-sm font-bold text-charcoal'

interface BulkOutcome {
    summary: { requested: number; issued: number; failed: number }
    rows: BulkIssueResult[]
}

const IssueCertificateForm = ({ onIssued }: { onIssued: () => void }) => {
    const { token, role } = useAuth()
    const toast = useToast()
    const { companies } = useCompanies()
    // Only the owner (the admin) can sign.
    const canSign = role === 'admin'

    // What to issue
    const [companyId, setCompanyId] = useState('')
    const [types, setTypes] = useState<CertificateType[]>([])
    const [typeSel, setTypeSel] = useState('')
    const [typeName, setTypeName] = useState('')
    const [kind, setKind] = useState<CertificateKind>('letter')
    const [title, setTitle] = useState('')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [issueDate, setIssueDate] = useState('')
    const [values, setValues] = useState<Record<string, string>>({})
    const [extraKeys, setExtraKeys] = useState<string[]>([])
    // Old-style names ({{CourseName}}) the chosen saved text already used; they stay valid. Typed ones do not.
    const [legacy, setLegacy] = useState<string[]>([])
    // The text the "Fill in the details" fields are built from: updated 700 ms after typing stops,
    // when the text box loses focus, or when a type is chosen. Never on every keystroke.
    const [settled, setSettled] = useState({ title: '', subject: '', body: '' })
    const [signName, setSignName] = useState('')
    const [signTitle, setSignTitle] = useState('')
    const [sendEmail, setSendEmail] = useState(true)
    // The signature image for this issue only. Memory (React state) only; cleared after issuing or on Remove.
    const [signature, setSignature] = useState<PickedSignature | null>(null)
    const [saveTemplate, setSaveTemplate] = useState(true)

    // Who gets it
    const [employees, setEmployees] = useState<User[] | null>(null)
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<string[]>([])

    // Flow
    const [busy, setBusy] = useState(false)
    const [preview, setPreview] = useState<CertificatePreview | null>(null)
    // Blob URL of the real PDF layout for the preview; null = show the plain text fallback.
    const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null)

    // Free the previous blob URL whenever it is replaced or cleared, and on unmount.
    useEffect(() => () => { if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl) }, [previewPdfUrl])

    const [outcome, setOutcome] = useState<BulkOutcome | null>(null)

    const closePreview = () => {
        setPreview(null)
        setPreviewPdfUrl(null)
    }

    /* ------------------------------------------------------------ */
    /* Loading                                                       */
    /* ------------------------------------------------------------ */

    useEffect(() => {
        if (!token) return
        let cancelled = false

        getCertificateTypes(token, companyId || undefined)
            .then(res => {
                if (cancelled) return
                const list = res.data ?? []
                setTypes(list)
                // The chosen saved text is not offered for this company any more: keep the wording, as "new type".
                setTypeSel(prev =>
                    prev && prev !== CUSTOM && !list.some(t => typeKey(t) === prev) ? CUSTOM : prev
                )
            })
            .catch(error => {
                if (!cancelled) toast.showError(errorMessage(error, 'Failed to load letter types'))
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, companyId])

    useEffect(() => {
        if (!token) return
        let cancelled = false

        fetchAllEmployees(token)
            .then(res => {
                if (!cancelled) setEmployees((res.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
            })
            .catch(error => {
                if (!cancelled) {
                    setEmployees([])
                    toast.showError(errorMessage(error, 'Failed to load employees'))
                }
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    /* ------------------------------------------------------------ */
    /* Derived                                                       */
    /* ------------------------------------------------------------ */

    const companyNameOf = (id: string | null) => (id ? companies.find(c => c._id === id)?.name ?? '' : '')

    const typeOptions = [
        ...types.map(t => {
            const company = companyNameOf(t.companyId)
            return {
                value: typeKey(t),
                label: `${t.typeLabel}${t.source === 'default' ? ' (built-in)' : ''}${company ? ` - ${company}` : ''}`,
            }
        }),
        { value: CUSTOM, label: 'Other (write a new type)...' },
    ]

    const companyOptions = companies.map(c => ({ value: c._id, label: c.name }))

    const subjectUsed = kind === 'letter' ? subject : ''
    useEffect(() => {
        const timer = setTimeout(() => setSettled({ title, subject: subjectUsed, body }), 700)
        return () => clearTimeout(timer)
    }, [title, subjectUsed, body])
    const settleNow = () => setSettled({ title, subject: subjectUsed, body })

    // Values the admin has to type in: the ones in the text that the system cannot fill, plus any the backend
    // asked for (an automatic value it had no data for) while that placeholder is still in the text.
    const neededFor = (names: string[]) =>
        [...new Set([...names.filter(p => !isAutoVariable(p)), ...extraKeys.filter(k => names.includes(k))])]

    const settledScan = useMemo(
        () => scanPlaceholders([settled.title, settled.subject, settled.body], legacy),
        [settled, legacy]
    )
    const placeholders = settledScan.names
    const neededKeys = useMemo(() => neededFor(placeholders), [placeholders, extraKeys])   // eslint-disable-line react-hooks/exhaustive-deps
    const showJoiningDate = placeholders.includes('joiningDate') && !neededKeys.includes('joiningDate')

    // Preview and issue always check the text as it is right now, not the settled copy.
    const currentCheck = () => {
        const scan = scanPlaceholders([title, subjectUsed, body], legacy)
        const needed = neededFor(scan.names)
        return { scan, needed, joiningDate: scan.names.includes('joiningDate') && !needed.includes('joiningDate') }
    }

    const shownEmployees = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return employees ?? []
        return (employees ?? []).filter(e =>
            [e.name, e.email, e.position].some(v => typeof v === 'string' && v.toLowerCase().includes(q))
        )
    }, [employees, search])

    const allShownSelected = shownEmployees.length > 0 && shownEmployees.every(e => selected.includes(e._id))

    /* ------------------------------------------------------------ */
    /* Handlers                                                      */
    /* ------------------------------------------------------------ */

    const selectType = (value: string) => {
        setTypeSel(value)
        setExtraKeys([])
        setLegacy([])
        setSettled({ title: '', subject: '', body: '' })
        if (!value) return

        if (value === CUSTOM) {
            setTypeName('')
            setKind('letter')
            setTitle('')
            setSubject('')
            setBody('')
            return
        }

        const t = types.find(x => typeKey(x) === value)
        if (!t) return
        setTypeName(t.typeLabel)
        setKind(t.kind)
        setTitle(t.title)
        setSubject(t.subject ?? '')
        setBody(t.body)
        setLegacy(legacyNames(t.title, t.subject, t.body))
        setSettled({ title: t.title, subject: t.kind === 'letter' ? t.subject ?? '' : '', body: t.body })
        if (t.companyId) setCompanyId(t.companyId)
    }

    const toggleEmployee = (id: string) =>
        setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

    const toggleAllShown = () => {
        if (allShownSelected) {
            const shownIds = new Set(shownEmployees.map(e => e._id))
            setSelected(prev => prev.filter(id => !shownIds.has(id)))
            return
        }
        const next = [...new Set([...selected, ...shownEmployees.map(e => e._id)])]
        if (next.length > MAX_BULK) {
            toast.showWarning(`You can issue to at most ${MAX_BULK} employees at once. The first ${MAX_BULK} were selected.`)
        }
        setSelected(next.slice(0, MAX_BULK))
    }

    const validate = (): string | null => {
        if (!typeSel) return 'Choose a type of document first.'
        if (!typeName.trim()) return 'Enter a name for the new type, for example "Appreciation Certificate".'
        if (!title.trim()) return 'Add a title.'
        if (!body.trim()) return 'Add the text of the document.'
        if (selected.length === 0) return 'Choose at least one employee.'
        if (signature && !sendEmail) return 'A signed document has to be emailed: the email is the only copy with the signature. Turn on "Email the PDF" or remove the signature.'

        const { scan, needed } = currentCheck()
        if (scan.broken.length > 0) return brokenPlaceholderMessage(scan.broken)
        settleNow()   // make sure every field the message names is on screen
        const missing = needed.filter(k => !values[k]?.trim())
        if (missing.length > 0) return `Fill in: ${missing.map(humanizeVariable).join(', ')}.`
        return null
    }

    // withSignature: only the PDF preview, issue and bulk issue get the image, never the text preview.
    const buildPayload = (withSignature = false): IssuePayload => {
        const variables: Record<string, string> = {}
        const { needed, joiningDate } = currentCheck()
        for (const key of [...needed, ...(joiningDate ? ['joiningDate'] : [])]) {
            const value = values[key]?.trim()
            if (value) variables[key] = value
        }

        const signatory: IssuePayload['signatory'] = {}
        if (signName.trim()) signatory.name = signName.trim()
        if (signTitle.trim()) signatory.title = signTitle.trim()

        return {
            type: typeName.trim(),
            title: title.trim(),
            subject: kind === 'letter' ? subject.trim() : '',
            body: body.trim(),
            kind,
            companyId: companyId || undefined,
            issueDate: issueDate || undefined,
            variables,
            signatory: Object.keys(signatory).length ? signatory : undefined,
            sendEmail,
            saveTemplate,
            signatureImage: withSignature && canSign && signature ? signature.base64 : undefined,
        }
    }

    // The backend lists values it could not fill in: show a field for each one.
    const rememberMissing = (messages: string[]) => {
        const keys = messages.flatMap(parseMissingVariables)
        if (keys.length) setExtraKeys(prev => [...new Set([...prev, ...keys])])
        return keys.length > 0
    }

    const handleFailure = (error: unknown, fallback: string) => {
        const message = errorMessage(error, fallback)
        if (rememberMissing([message])) {
            toast.showError('Some values are missing. Fill in the new fields and try again.')
        } else {
            toast.showError(message)
        }
    }

    const handlePreview = async () => {
        if (!token) return
        const problem = validate()
        if (problem) {
            toast.showError(problem)
            return
        }

        setBusy(true)
        try {
            const payload = { employeeId: selected[0], ...buildPayload() }
            const [res, pdf] = await Promise.all([
                previewCertificate(token, payload),
                // The PDF is the real design (with the signature, if one was chosen). If it fails, the plain text preview is shown.
                previewCertificatePdf(token, { employeeId: selected[0], ...buildPayload(true) }).catch(() => null),
            ])
            setPreviewPdfUrl(pdf ? URL.createObjectURL(pdf) : null)
            if (res.data) setPreview(res.data)
        } catch (error) {
            handleFailure(error, 'Could not build the preview')
        } finally {
            setBusy(false)
        }
    }

    const handleIssue = async () => {
        if (!token) return
        const problem = validate()
        if (problem) {
            toast.showError(problem)
            return
        }

        setBusy(true)
        closePreview()
        try {
            if (selected.length === 1) {
                const res = await issueCertificate(token, { employeeId: selected[0], ...buildPayload(true) })
                setSignature(null)   // used once; never kept
                if (res.email?.status === 'failed') {
                    toast.showWarning(res.message || 'Issued, but the email could not be sent. You can resend it.', 6000)
                } else {
                    toast.showSuccess(res.message || 'Issued')
                }
                onIssued()
            } else {
                const res = await bulkIssueCertificates(token, { employeeIds: selected, ...buildPayload(true) })
                setSignature(null)   // one signature for the whole batch, then discarded
                const rows = res.data ?? []
                rememberMissing(rows.filter(r => !r.success && r.error).map(r => r.error as string))
                setOutcome({
                    summary: res.summary ?? { requested: rows.length, issued: rows.filter(r => r.success).length, failed: rows.filter(r => !r.success).length },
                    rows,
                })
            }
        } catch (error) {
            handleFailure(error, 'Could not issue the document')
        } finally {
            setBusy(false)
        }
    }

    const closeOutcome = () => {
        const anyIssued = outcome?.rows.some(r => r.success)
        setOutcome(null)
        if (anyIssued) onIssued()
    }

    const retryFailed = () => {
        if (!outcome) return
        setSelected(outcome.rows.filter(r => !r.success).map(r => r.employeeId))
        setOutcome(null)
    }

    const nameOf = (id: string) => employees?.find(e => e._id === id)?.name ?? id

    /* ------------------------------------------------------------ */
    /* Render                                                        */
    /* ------------------------------------------------------------ */

    return (
        <>
            <div className="grid gap-5 lg:grid-cols-5">
                {/* Left: the document */}
                <div className="space-y-5 lg:col-span-3">
                    <section className={card}>
                        <h5 className={cardTitle}>Document</h5>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <SelectField
                                label="Type"
                                required
                                value={typeSel}
                                onChange={e => selectType(e.target.value)}
                                options={typeOptions}
                                placeholder="Choose a type"
                            />
                            <SelectField
                                label="Layout"
                                value={kind}
                                onChange={e => setKind(e.target.value as CertificateKind)}
                                options={[
                                    { value: 'letter', label: 'Letter (portrait)' },
                                    { value: 'certificate', label: 'Certificate (landscape)' },
                                ]}
                                disabled={!typeSel}
                            />

                            {typeSel === CUSTOM && (
                                <div className="sm:col-span-2">
                                    <Input
                                        label="New type name"
                                        required
                                        value={typeName}
                                        handleChange={e => setTypeName(e.target.value)}
                                        placeholder="Appreciation Certificate"
                                        maxLength={100}
                                        helperText="Saved with the wording, so you can pick it from the list next time."
                                    />
                                </div>
                            )}

                            <SelectField
                                label="Company"
                                value={companyId}
                                onChange={e => setCompanyId(e.target.value)}
                                options={companyOptions}
                                placeholder="Employee's own company"
                                helperText="Decides the logo, sender and signatory."
                            />
                            <div className="w-full">
                                <label className="mb-2 block text-sm font-medium text-charcoal">Issue date</label>
                                <input
                                    type="date"
                                    value={issueDate}
                                    onChange={e => setIssueDate(e.target.value)}
                                    className="h-11 w-full rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                                />
                                <p className="mt-1.5 text-xs text-charcoal/50">Leave empty for today.</p>
                            </div>
                        </div>
                    </section>

                    {typeSel && (
                        <section className={card}>
                            <h5 className={cardTitle}>Wording</h5>
                            <WordingFields
                                title={title}
                                body={body}
                                onTitleChange={setTitle}
                                onBodyChange={setBody}
                                onBodyBlur={settleNow}
                                legacy={legacy}
                                showFillHint
                                subject={subject}
                                onSubjectChange={kind === 'letter' ? setSubject : undefined}
                            />
                        </section>
                    )}

                    {(neededKeys.length > 0 || showJoiningDate) && (
                        <section className={card}>
                            <h5 className={cardTitle}>Fill in the details</h5>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {neededKeys.map(key => (
                                    <Input
                                        key={key}
                                        label={humanizeVariable(key)}
                                        required
                                        value={values[key] ?? ''}
                                        handleChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                                        maxLength={500}
                                        helperText={isAutoVariable(key) ? 'The system had no value for this employee.' : undefined}
                                    />
                                ))}
                                {showJoiningDate && (
                                    <Input
                                        label="Joining date"
                                        value={values.joiningDate ?? ''}
                                        handleChange={e => setValues(v => ({ ...v, joiningDate: e.target.value }))}
                                        placeholder="e.g. 1 March 2024"
                                        maxLength={500}
                                        helperText="Optional. Leave empty to use the date the account was created."
                                    />
                                )}
                            </div>
                        </section>
                    )}

                    <details className={card}>
                        <summary className="cursor-pointer font-heading text-sm font-bold text-charcoal">
                            Signatory (optional)
                        </summary>
                        <p className="mb-4 mt-2 text-xs text-charcoal/50">Leave empty to use the company&apos;s signatory.</p>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Input label="Name" value={signName} handleChange={e => setSignName(e.target.value)} maxLength={100} />
                            <Input label="Job title" value={signTitle} handleChange={e => setSignTitle(e.target.value)} maxLength={100} />
                        </div>
                    </details>

                    {canSign && (
                        <section className={card}>
                            <h5 className={cardTitle}>Sign this document</h5>
                            <SignaturePicker
                                value={signature}
                                onChange={setSignature}
                                disabled={busy}
                                note={
                                    <>
                                        Only the emailed PDF carries the signature{selected.length > 1 ? ' (one signature for all selected employees)' : ''}.
                                        Copies opened in the app show &quot;Digitally signed by ...&quot; instead.
                                        {!sendEmail && signature && <span className="block text-red-600">Turn on &quot;Email the PDF&quot; to issue a signed document.</span>}
                                    </>
                                }
                            />
                        </section>
                    )}
                </div>

                {/* Right: recipients and actions */}
                <div className="space-y-5 lg:col-span-2">
                    <section className={card}>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h5 className="font-heading text-sm font-bold text-charcoal">Employees</h5>
                            <span className="text-xs text-charcoal/50">{selected.length} selected</span>
                        </div>

                        <div className="relative mb-3">
                            <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal/40" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search name, email or position"
                                className="h-11 w-full rounded-xl border border-charcoal/10 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>

                        <label className="mb-2 flex cursor-pointer items-center gap-2.5 border-b border-charcoal/5 pb-2 text-sm font-medium text-charcoal/70">
                            <input
                                type="checkbox"
                                checked={allShownSelected}
                                onChange={toggleAllShown}
                                disabled={shownEmployees.length === 0}
                                className="size-4 accent-blue-500"
                            />
                            Select all shown
                        </label>

                        <div className="max-h-72 space-y-0.5 overflow-y-auto">
                            {employees === null ? (
                                <p className="py-6 text-center text-sm text-charcoal/50">Loading...</p>
                            ) : shownEmployees.length === 0 ? (
                                <p className="py-6 text-center text-sm text-charcoal/40">No employees found.</p>
                            ) : (
                                shownEmployees.map(e => (
                                    <label
                                        key={e._id}
                                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-2 transition hover:bg-charcoal/[0.03]"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(e._id)}
                                            onChange={() => toggleEmployee(e._id)}
                                            className="size-4 shrink-0 accent-blue-500"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-charcoal">{e.name}</span>
                                            <span className="block truncate text-xs text-charcoal/45">
                                                {[e.position, e.email].filter(Boolean).join(' - ')}
                                            </span>
                                        </span>
                                        {e.status === 'inactive' && <StatusBadge status="inactive" variant="employee" />}
                                    </label>
                                ))
                            )}
                        </div>

                        {selected.length > 1 && (
                            <p className="mt-3 text-xs text-charcoal/50">
                                Everyone gets the same text. Name, position and dates are filled in for each person.
                            </p>
                        )}
                    </section>

                    <section className={card}>
                        <h5 className={cardTitle}>Options</h5>
                        <div className="space-y-3">
                            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-charcoal/80">
                                <input
                                    type="checkbox"
                                    checked={sendEmail}
                                    onChange={e => setSendEmail(e.target.checked)}
                                    className="mt-0.5 size-4 accent-blue-500"
                                />
                                <span>
                                    Email the PDF to the employee
                                    <span className="block text-xs text-charcoal/45">You can always resend it later.</span>
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-charcoal/80">
                                <input
                                    type="checkbox"
                                    checked={saveTemplate}
                                    onChange={e => setSaveTemplate(e.target.checked)}
                                    className="mt-0.5 size-4 accent-blue-500"
                                />
                                <span>
                                    Remember this wording
                                    <span className="block text-xs text-charcoal/45">If you changed the text, it is used next time for this type.</span>
                                </span>
                            </label>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handlePreview}
                                disabled={busy}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03] disabled:opacity-50"
                            >
                                <FiEye className="size-4" /> Preview
                            </button>
                            <ButtonEmerald
                                icon={<FiSend className="size-4" />}
                                onClick={handleIssue}
                                loading={busy}
                                disabled={selected.length === 0}
                                className="!h-11"
                            >
                                {selected.length > 1 ? `Issue to ${selected.length} employees` : 'Issue'}
                            </ButtonEmerald>
                        </div>
                    </section>
                </div>
            </div>

            {/* Preview */}
            <ModalBox
                open={!!preview}
                onClose={closePreview}
                size="4xl"
                title="Preview"
                description={
                    preview
                        ? `Shown for ${preview.recipient.name}${selected.length > 1 ? ` (the first of ${selected.length})` : ''}. Nothing was saved or sent.`
                        : undefined
                }
                footer={
                    <>
                        <button
                            type="button"
                            onClick={closePreview}
                            className="inline-flex h-11 items-center rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]"
                        >
                            Back to editing
                        </button>
                        <ButtonEmerald icon={<FiSend className="size-4" />} onClick={handleIssue} loading={busy} className="!h-11">
                            {selected.length > 1 ? `Issue to ${selected.length} employees` : 'Issue'}
                        </ButtonEmerald>
                    </>
                }
            >
                {preview && (
                    <div className="space-y-4">
                        {previewPdfUrl ? (
                            <iframe
                                src={previewPdfUrl}
                                title="Document preview"
                                className="h-[70vh] w-full rounded-lg border border-charcoal/10"
                            />
                        ) : (
                            <CertificateDocument
                                kind={preview.kind}
                                title={preview.title}
                                subject={preview.subject}
                                body={preview.body}
                                companyName={preview.companyName}
                                issueDate={preview.issueDate}
                                signatory={preview.signatory}
                            />
                        )}
                        {saveTemplate && preview.willRememberWording && (
                            <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-700">
                                This wording is new, so it will be saved for &quot;{preview.typeLabel}&quot; and used next time.
                            </p>
                        )}
                    </div>
                )}
            </ModalBox>

            {/* Bulk result */}
            <ModalBox
                open={!!outcome}
                onClose={closeOutcome}
                size="2xl"
                title={outcome ? `Issued ${outcome.summary.issued} of ${outcome.summary.requested}` : 'Result'}
                description={outcome && outcome.summary.failed > 0 ? `${outcome.summary.failed} could not be issued. See the reason below.` : undefined}
                footer={
                    <>
                        {outcome && outcome.summary.failed > 0 && (
                            <button
                                type="button"
                                onClick={retryFailed}
                                className="inline-flex h-11 items-center rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]"
                            >
                                Fix and retry the failed ones
                            </button>
                        )}
                        <ButtonEmerald onClick={closeOutcome} className="!h-11">Done</ButtonEmerald>
                    </>
                }
            >
                {outcome && (
                    <div className="overflow-x-auto rounded-lg border border-charcoal/5">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Employee</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Result</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {outcome.rows.map(row => (
                                    <tr key={row.employeeId}>
                                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{nameOf(row.employeeId)}</td>
                                        <td className="px-4 py-3">
                                            {row.success ? (
                                                <span className="text-blue-700">{row.referenceNo}</span>
                                            ) : (
                                                <span className="text-red-600">{row.error}</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            {row.success && row.email ? <StatusBadge status={row.email} variant="email" /> : <span className="text-xs text-gray-400">-</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ModalBox>
        </>
    )
}

export default IssueCertificateForm
