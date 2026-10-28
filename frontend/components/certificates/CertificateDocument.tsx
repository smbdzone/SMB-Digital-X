import React from 'react'
import type { CertificateKind, Signatory } from '@/services/certificate.services'
import { formatDate } from '@/lib/utils'

interface CertificateDocumentProps {
    kind: CertificateKind
    title: string
    body: string
    companyName: string
    issueDate: string
    signatory: Signatory
}

/** A simple on-screen paper view of the final text. The real layout is the PDF. */
const CertificateDocument = ({ kind, title, body, companyName, issueDate, signatory }: CertificateDocumentProps) => {
    const isCertificate = kind === 'certificate'

    return (
        <div className={`rounded-xl bg-white p-6 shadow-sm sm:p-8 ${isCertificate ? 'border-4 border-double border-charcoal/20' : 'border border-charcoal/10'}`}>
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-charcoal/50">{companyName}</p>

            <h3 className={`mt-3 text-center font-heading font-bold text-charcoal ${isCertificate ? 'text-2xl' : 'text-lg'}`}>{title}</h3>

            <p className={`mt-6 whitespace-pre-wrap text-sm leading-7 text-charcoal/80 ${isCertificate ? 'text-center' : ''}`}>{body}</p>

            <div className="mt-8 flex items-end justify-between gap-4 text-sm">
                <p className="text-charcoal/60">{formatDate(issueDate)}</p>
                <div className="text-right">
                    {signatory.signature && <p className="font-heading text-lg italic text-charcoal">{signatory.signature}</p>}
                    {signatory.name && <p className="font-semibold text-charcoal">{signatory.name}</p>}
                    {signatory.title && <p className="text-xs text-charcoal/50">{signatory.title}</p>}
                </div>
            </div>
        </div>
    )
}

export default CertificateDocument
