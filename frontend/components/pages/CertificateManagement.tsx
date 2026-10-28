'use client'

import React, { useState } from 'react'

import CertificateIssuedList from '@/components/certificates/CertificateIssuedList'
import IssueCertificateForm from '@/components/certificates/IssueCertificateForm'
import SavedTexts from '@/components/certificates/SavedTexts'

type Tab = 'issued' | 'issue' | 'texts'

const TABS: { id: Tab; label: string }[] = [
    { id: 'issued', label: 'Issued' },
    { id: 'issue', label: 'Issue new' },
    { id: 'texts', label: 'Saved texts' },
]

const CertificateManagement = () => {
    const [tab, setTab] = useState<Tab>('issued')

    return (
        <>
            <div className="py-4 lg:py-6">
                <h4 className="text-md font-bold font-heading sm:text-xl">Certificates &amp; Letters</h4>
                <p className="mt-1 text-sm text-charcoal/45">
                    Issue joining letters, experience letters, certificates and more. Each one is emailed as a PDF from the employee&apos;s company.
                </p>
            </div>

            <div className="mb-6 flex flex-wrap gap-2 border-b border-charcoal/10 pb-3" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === t.id
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-charcoal/60 hover:bg-charcoal/[0.04] hover:text-charcoal'
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Each tab loads fresh when opened, so the list is up to date after issuing. */}
            {tab === 'issued' && <CertificateIssuedList />}
            {tab === 'issue' && <IssueCertificateForm onIssued={() => setTab('issued')} />}
            {tab === 'texts' && <SavedTexts />}
        </>
    )
}

export default CertificateManagement
