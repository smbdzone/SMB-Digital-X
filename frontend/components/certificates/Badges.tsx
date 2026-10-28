import React from 'react'
import type { CertificateKind, CertificateStatus } from '@/services/certificate.services'

const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize'

const kindStyles: Record<CertificateKind, string> = {
    letter: 'bg-blue-50 text-blue-700',
    certificate: 'bg-amber-50 text-amber-700',
}

const statusStyles: Record<CertificateStatus, string> = {
    issued: 'bg-emerald-50 text-emerald-700',
    revoked: 'bg-red-50 text-red-700',
}

export const KindBadge = ({ kind }: { kind: CertificateKind }) => (
    <span className={`${base} ${kindStyles[kind] ?? 'bg-gray-100 text-gray-600'}`}>{kind}</span>
)

export const CertificateStatusBadge = ({ status }: { status: CertificateStatus }) => (
    <span className={`${base} ${statusStyles[status] ?? 'bg-gray-100 text-gray-600'}`}>{status}</span>
)
