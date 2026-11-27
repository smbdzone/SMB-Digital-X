'use client';

import React from 'react';

import OwnerConsoleNote from '@/components/ui/OwnerConsoleNote';
import { useCompanies } from '@/hooks/useCompanies';
import { letterheadLabel } from '@/services/company.services';

/** Companies, read-only: adding, editing and (de)activating them is done in the Owner Console (signed and recorded). */
const Companies = () => {
    const { companies, loading } = useCompanies({ all: true });

    return (
        <>
            <div className="flex items-center justify-between py-4 lg:py-6">
                <div>
                    <h4 className="text-md font-bold font-heading sm:text-xl">Companies</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Branding and email settings used on salary slips.</p>
                </div>
            </div>
            <OwnerConsoleNote className="mb-5">Adding, changing and (de)activating companies (details, contacts, signatory, letterhead, logo) is done in the Owner Console.</OwnerConsoleNote>

            {loading && !companies.length ? (
                <p className="py-10 text-center text-sm text-charcoal/50">Loading...</p>
            ) : companies.length === 0 ? (
                <p className="py-10 text-center text-sm text-charcoal/50">No companies yet. They are added in the Owner Console.</p>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {companies.map(company => (
                        <div key={company._id} className={`rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm ${company.isActive ? '' : 'opacity-70'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    {company.logoUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={company.logoUrl} alt="" className="size-12 shrink-0 rounded-lg border border-charcoal/5 object-contain p-1" onError={e => (e.currentTarget.style.visibility = 'hidden')} />
                                    ) : (
                                        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: company.brandColor }}>
                                            {company.name.slice(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="truncate font-heading text-sm font-bold text-charcoal">{company.name}</p>
                                        <p className="truncate text-xs text-charcoal/45">{company.code} · Letterhead: {letterheadLabel(company.letterheadDesign)}</p>
                                    </div>
                                </div>
                                <span className="mt-1 size-4 shrink-0 rounded-full border border-black/10" style={{ background: company.brandColor }} title={company.brandColor} />
                            </div>

                            <dl className="mt-4 space-y-1.5 text-xs text-charcoal/60">
                                <div className="flex justify-between gap-3"><dt>Sender name</dt><dd className="truncate font-medium text-charcoal">{company.email?.fromName || company.name}</dd></div>
                                <div className="flex justify-between gap-3"><dt>Sender email</dt><dd className="truncate font-medium text-charcoal">{company.email?.fromEmail || 'Default account'}</dd></div>
                                <div className="flex justify-between gap-3"><dt>Signed by</dt><dd className="truncate font-medium text-charcoal">{company.signatory?.name || '-'}</dd></div>
                                <div className="flex justify-between gap-3"><dt>Currency</dt><dd className="font-medium text-charcoal">{company.currency}</dd></div>
                            </dl>

                            <div className="mt-5 flex items-center justify-between border-t border-charcoal/5 pt-4">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${company.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {company.isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
};

export default Companies;
