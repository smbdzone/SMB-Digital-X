'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { FiDownload, FiEye, FiMail, FiSearch, FiSlash } from 'react-icons/fi'

import ModalBox from '@/components/ui/ModalBox'
import Pagination from '@/components/ui/Pagination'
import SelectField from '@/components/ui/SelectField'
import { StatusBadge } from '@/components/ui/shared'
import { CertificateStatusBadge, KindBadge } from './Badges'
import PdfViewerModal, { type PdfTarget } from './PdfViewerModal'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useCompanies } from '@/hooks/useCompanies'
import {
    CertificateKind,
    CertificatePagination,
    CertificateStatus,
    ICertificate,
    getCertificatePdf,
    getCertificates,
    resendCertificateEmail,
    revokeCertificate,
    saveBlob,
} from '@/services/certificate.services'
import { errorMessage, formatDate } from '@/lib/utils'

const th = 'px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
const filterInput =
    'h-11 w-full rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10'

const CertificateIssuedList = () => {
    const { token } = useAuth()
    const toast = useToast()
    const { companies } = useCompanies()

    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [companyId, setCompanyId] = useState('')
    const [kind, setKind] = useState<CertificateKind | ''>('')
    const [status, setStatus] = useState<CertificateStatus | ''>('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [page, setPage] = useState(1)

    const [items, setItems] = useState<ICertificate[]>([])
    const [pagination, setPagination] = useState<CertificatePagination | null>(null)
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)

    const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null)
    const [revokeTarget, setRevokeTarget] = useState<ICertificate | null>(null)
    const [revokeReason, setRevokeReason] = useState('')

    // Wait until the person stops typing before asking the server.
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search.trim())
            setPage(1)
        }, 400)
        return () => clearTimeout(timer)
    }, [search])

    const load = useCallback(async () => {
        if (!token) return
        setLoading(true)
        try {
            const res = await getCertificates(token, {
                search: debouncedSearch,
                companyId,
                kind,
                status,
                from,
                to,
                page,
                limit: 20,
            })
            setItems(res.data ?? [])
            setPagination(res.pagination ?? null)
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load certificates'))
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, debouncedSearch, companyId, kind, status, from, to, page])

    useEffect(() => {
        load()
    }, [load])

    const companyOptions = companies.map(c => ({ value: c._id, label: c.name }))

    const openPdf = (c: ICertificate) => setPdfTarget({ _id: c._id, referenceNo: c.referenceNo, title: c.title })

    const handleDownload = async (c: ICertificate) => {
        if (!token) return
        setBusyId(c._id)
        try {
            const blob = await getCertificatePdf(token, c._id)
            saveBlob(blob, `${c.referenceNo}.pdf`)
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not download the PDF'))
        } finally {
            setBusyId(null)
        }
    }

    const handleResend = async (c: ICertificate) => {
        if (!token) return
        setBusyId(c._id)
        try {
            const res = await resendCertificateEmail(token, c._id)
            toast.showSuccess(res.message || 'Email sent')
            await load()
        } catch (error) {
            toast.showError(errorMessage(error, 'The email could not be sent'))
            await load()
        } finally {
            setBusyId(null)
        }
    }

    const openRevoke = (c: ICertificate) => {
        setRevokeTarget(c)
        setRevokeReason('')
    }

    const handleRevoke = async () => {
        if (!token || !revokeTarget) return
        setBusyId(revokeTarget._id)
        try {
            const res = await revokeCertificate(token, revokeTarget._id, revokeReason)
            toast.showSuccess(res.message || 'Certificate revoked')
            setRevokeTarget(null)
            await load()
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not revoke the certificate'))
        } finally {
            setBusyId(null)
        }
    }

    const hasFilters = !!(debouncedSearch || companyId || kind || status || from || to)

    const clearFilters = () => {
        setSearch('')
        setDebouncedSearch('')
        setCompanyId('')
        setKind('')
        setStatus('')
        setFrom('')
        setTo('')
        setPage(1)
    }

    return (
        <>
            {/* Filters */}
            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <div className="relative sm:col-span-2">
                    <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal/40" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, reference or type"
                        className={`${filterInput} pl-9 placeholder:text-charcoal/35`}
                    />
                </div>
                <SelectField
                    value={companyId}
                    onChange={e => { setCompanyId(e.target.value); setPage(1) }}
                    options={companyOptions}
                    placeholder="All companies"
                />
                <SelectField
                    value={kind}
                    onChange={e => { setKind(e.target.value as CertificateKind | ''); setPage(1) }}
                    options={[{ value: 'letter', label: 'Letters' }, { value: 'certificate', label: 'Certificates' }]}
                    placeholder="All layouts"
                />
                <SelectField
                    value={status}
                    onChange={e => { setStatus(e.target.value as CertificateStatus | ''); setPage(1) }}
                    options={[{ value: 'issued', label: 'Issued' }, { value: 'revoked', label: 'Revoked' }]}
                    placeholder="Any status"
                />
                <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-3">
                    <input
                        type="date"
                        value={from}
                        onChange={e => { setFrom(e.target.value); setPage(1) }}
                        aria-label="Issued from"
                        className={filterInput}
                    />
                    <span className="text-xs text-charcoal/40">to</span>
                    <input
                        type="date"
                        value={to}
                        onChange={e => { setTo(e.target.value); setPage(1) }}
                        aria-label="Issued until"
                        className={filterInput}
                    />
                    {hasFilters && (
                        <button type="button" onClick={clearFilters} className="shrink-0 text-sm font-semibold text-blue-600 hover:text-blue-700">
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className={th}>Reference</th>
                            <th className={th}>Employee</th>
                            <th className={th}>Document</th>
                            <th className={th}>Issued on</th>
                            <th className={th}>Status</th>
                            <th className={th}>Email</th>
                            <th className={th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading && items.length === 0 ? (
                            <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">
                                    {hasFilters
                                        ? 'No documents match these filters.'
                                        : 'Nothing issued yet. Use the “Issue” tab to create the first letter or certificate.'}
                                </td>
                            </tr>
                        ) : (
                            items.map(c => {
                                const rowBusy = busyId === c._id
                                const revoked = c.status === 'revoked'
                                return (
                                    <tr key={c._id} className={rowBusy ? 'opacity-60' : ''}>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm font-medium text-gray-900">{c.referenceNo}</td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <p className="font-medium text-gray-900">{c.recipient?.name}</p>
                                            <p className="mt-0.5 text-xs text-gray-400">{c.recipient?.email}</p>
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className="whitespace-nowrap text-sm text-gray-700">{c.typeLabel}</span>
                                                <KindBadge kind={c.kind} />
                                            </div>
                                            <p className="mt-0.5 text-xs text-gray-400">{c.companyName}</p>
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">{formatDate(c.issueDate)}</td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <CertificateStatusBadge status={c.status} />
                                            {revoked && (
                                                <p className="mt-1 max-w-[12rem] truncate text-xs text-gray-400" title={c.revokeReason || undefined}>
                                                    {c.revokeReason || formatDate(c.revokedAt)}
                                                </p>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            {revoked ? (
                                                <span className="text-xs text-gray-400">-</span>
                                            ) : (
                                                <span title={c.email?.error || undefined}>
                                                    <StatusBadge status={c.email?.status ?? 'not_sent'} variant="email" />
                                                </span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => openPdf(c)} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50" title="View PDF"><FiEye className="size-4" /></button>
                                                <button onClick={() => handleDownload(c)} disabled={rowBusy} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50 disabled:opacity-40" title="Download PDF"><FiDownload className="size-4" /></button>
                                                {!revoked && (
                                                    <>
                                                        <button
                                                            onClick={() => handleResend(c)}
                                                            disabled={rowBusy}
                                                            className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-40"
                                                            title={c.email?.status === 'sent' ? 'Send the email again' : 'Send the email'}
                                                        >
                                                            <FiMail className="size-4" />
                                                        </button>
                                                        <button onClick={() => openRevoke(c)} disabled={rowBusy} className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40" title="Revoke"><FiSlash className="size-4" /></button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
            {pagination && <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total} onChange={setPage} disabled={loading} />}

            <PdfViewerModal target={pdfTarget} onClose={() => setPdfTarget(null)} />

            {/* Revoke */}
            <ModalBox
                open={!!revokeTarget}
                onClose={() => setRevokeTarget(null)}
                size="md"
                title="Revoke this document?"
                description={revokeTarget ? `${revokeTarget.referenceNo} for ${revokeTarget.recipient?.name}. The employee will no longer see it, and it cannot be emailed again.` : undefined}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setRevokeTarget(null)}
                            className="inline-flex h-11 items-center rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleRevoke}
                            disabled={!!busyId}
                            className="inline-flex h-11 items-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                        >
                            {busyId ? 'Revoking...' : 'Revoke'}
                        </button>
                    </>
                }
            >
                <label className="mb-2 block text-sm font-medium text-charcoal">Reason (optional)</label>
                <textarea
                    value={revokeReason}
                    onChange={e => setRevokeReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Issued by mistake, wrong dates, ..."
                    className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                />
            </ModalBox>
        </>
    )
}

export default CertificateIssuedList
