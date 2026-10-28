'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { FiAward, FiDownload, FiEye } from 'react-icons/fi'

import { EmptyState } from '@/components/ui/shared'
import { KindBadge } from '@/components/certificates/Badges'
import PdfViewerModal, { type PdfTarget } from '@/components/certificates/PdfViewerModal'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { ICertificate, getCertificatePdf, getMyCertificates, saveBlob } from '@/services/certificate.services'
import { errorMessage, formatDate } from '@/lib/utils'

const MyCertificates = () => {
    const { token } = useAuth()
    const toast = useToast()

    const [items, setItems] = useState<ICertificate[]>([])
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null)

    const load = useCallback(async () => {
        if (!token) return
        setLoading(true)
        try {
            const res = await getMyCertificates(token)
            setItems(res.data ?? [])
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load your documents'))
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    useEffect(() => {
        load()
    }, [load])

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

    return (
        <div className="py-4 lg:py-6">
            <div className="mb-6">
                <h4 className="text-md font-bold font-heading sm:text-xl">My certificates &amp; letters</h4>
                <p className="mt-1 text-sm text-charcoal/45">Documents issued to you by your company appear here.</p>
            </div>

            {loading ? (
                <p className="py-10 text-center text-sm text-charcoal/50">Loading...</p>
            ) : items.length === 0 ? (
                <div className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                    <EmptyState text="No documents have been issued to you yet." />
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map(c => (
                        <div key={c._id} className="flex flex-col rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm">
                            <div className="flex items-start gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                    <FiAward className="size-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-heading text-sm font-bold text-charcoal">{c.title}</p>
                                    <p className="mt-0.5 truncate text-xs text-charcoal/45">{c.companyName}</p>
                                </div>
                                <KindBadge kind={c.kind} />
                            </div>

                            <div className="mt-5 space-y-1 text-xs text-charcoal/45">
                                <p>{c.typeLabel}</p>
                                <p>Issued on {formatDate(c.issueDate)}</p>
                                <p>Reference {c.referenceNo}</p>
                            </div>

                            <div className="mt-5 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPdfTarget({ _id: c._id, referenceNo: c.referenceNo, title: c.title })}
                                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-charcoal/10 bg-white text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]"
                                >
                                    <FiEye className="size-4" /> View
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDownload(c)}
                                    disabled={busyId === c._id}
                                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:shadow-blue-500/40 disabled:opacity-60"
                                >
                                    <FiDownload className="size-4" /> {busyId === c._id ? 'Please wait...' : 'Download'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <PdfViewerModal target={pdfTarget} onClose={() => setPdfTarget(null)} />
        </div>
    )
}

export default MyCertificates
