'use client'

import React, { useEffect, useState } from 'react'
import { FiDownload, FiExternalLink } from 'react-icons/fi'

import ModalBox from '@/components/ui/ModalBox'
import { useAuth } from '@/context/AuthContext'
import { getCertificatePdf } from '@/services/certificate.services'
import { errorMessage } from '@/lib/utils'

export interface PdfTarget {
    _id: string
    referenceNo: string
    title: string
}

interface PdfResult {
    id: string
    url?: string
    error?: string
}

const actionClass =
    'inline-flex h-11 items-center gap-2 rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03]'

/** Shows a certificate PDF inside the page. The file is fetched with the login token. */
const PdfViewerModal = ({ target, onClose }: { target: PdfTarget | null; onClose: () => void }) => {
    const { token } = useAuth()
    const [result, setResult] = useState<PdfResult | null>(null)
    const id = target?._id

    useEffect(() => {
        if (!id || !token) return

        let cancelled = false
        let objectUrl: string | null = null

        getCertificatePdf(token, id)
            .then(blob => {
                objectUrl = URL.createObjectURL(blob)
                if (cancelled) {
                    URL.revokeObjectURL(objectUrl)
                    return
                }
                setResult({ id, url: objectUrl })
            })
            .catch(error => {
                if (!cancelled) setResult({ id, error: errorMessage(error, 'Could not load the PDF') })
            })

        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [id, token])

    const current = result && result.id === id ? result : null
    const loading = !!id && !current
    const fileName = `${target?.referenceNo ?? 'certificate'}.pdf`

    return (
        <ModalBox
            open={!!target}
            onClose={onClose}
            size="4xl"
            title={target?.title ?? 'Document'}
            description={target?.referenceNo}
            footer={
                current?.url ? (
                    <>
                        <a href={current.url} target="_blank" rel="noreferrer" className={actionClass}>
                            <FiExternalLink className="size-4" /> Open in new tab
                        </a>
                        <a
                            href={current.url}
                            download={fileName}
                            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:shadow-blue-500/40"
                        >
                            <FiDownload className="size-4" /> Download PDF
                        </a>
                    </>
                ) : undefined
            }
        >
            {loading && <p className="py-16 text-center text-sm text-charcoal/50">Loading PDF...</p>}
            {current?.error && <p className="py-16 text-center text-sm text-red-500">{current.error}</p>}
            {current?.url && (
                <iframe
                    src={current.url}
                    title={target?.title ?? 'Certificate PDF'}
                    className="h-[60vh] w-full rounded-lg border border-charcoal/10"
                />
            )}
        </ModalBox>
    )
}

export default PdfViewerModal
