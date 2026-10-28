'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FiFileText } from 'react-icons/fi';

import ModalBox from '../ui/ModalBox';
import SalaryDetails from '../salary/SalaryDetails';
import { EmptyState } from '@/components/ui/shared';
import { getMySalaries, ISalary, salaryCompanyLogo, salaryCompanyName } from '@/services/salary.services';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { errorMessage, formatCurrency, formatDate, formatMonthLabel } from '@/lib/utils';

const MySalarySlips = () => {
    const { token } = useAuth();
    const toast = useToast();

    const [month, setMonth] = useState('');
    const [slips, setSlips] = useState<ISalary[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<ISalary | null>(null);

    const load = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const response = await getMySalaries(token, month || undefined);
            setSlips(response.data ?? []);
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to load your salary slips'));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, month]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="py-4 lg:py-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-md font-bold font-heading sm:text-xl">My salary slips</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Slips appear here once your salary has been paid.</p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="month"
                        value={month}
                        onChange={e => setMonth(e.target.value)}
                        className="h-11 rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                    />
                    {month && (
                        <button onClick={() => setMonth('')} className="text-sm font-semibold text-blue-600 hover:text-blue-700">Show all</button>
                    )}
                </div>
            </div>

            {loading ? (
                <p className="py-10 text-center text-sm text-charcoal/50">Loading...</p>
            ) : slips.length === 0 ? (
                <div className="rounded-2xl border border-charcoal/5 bg-white shadow-sm">
                    <EmptyState text={month ? `No paid slip for ${formatMonthLabel(month)}.` : 'No paid salary slips yet.'} />
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {slips.map(slip => {
                        const logo = salaryCompanyLogo(slip);
                        return (
                            <button
                                key={slip._id}
                                onClick={() => setSelected(slip)}
                                className="rounded-2xl border border-charcoal/5 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                            >
                                <div className="flex items-center gap-3">
                                    {logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={logo} alt="" className="size-10 rounded-lg border border-charcoal/5 object-contain p-1" onError={e => (e.currentTarget.style.display = 'none')} />
                                    ) : (
                                        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><FiFileText className="size-5" /></div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="truncate font-heading text-sm font-bold text-charcoal">{formatMonthLabel(slip.month)}</p>
                                        <p className="truncate text-xs text-charcoal/45">{salaryCompanyName(slip)}</p>
                                    </div>
                                </div>
                                <p className="mt-5 text-xs text-charcoal/45">Net pay</p>
                                <p className="font-heading text-2xl font-bold text-charcoal">{formatCurrency(slip.netPay, slip.currency)}</p>
                                <p className="mt-2 text-xs text-charcoal/45">Paid on {formatDate(slip.paidOn)}</p>
                            </button>
                        );
                    })}
                </div>
            )}

            <ModalBox open={!!selected} onClose={() => setSelected(null)} size="xl" title="Salary slip">
                {selected && <SalaryDetails salary={selected} />}
            </ModalBox>
        </div>
    );
};

export default MySalarySlips;
