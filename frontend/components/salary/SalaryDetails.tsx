'use client';

import React from 'react';
import { StatusBadge } from '@/components/ui/shared';
import { formatCurrency, formatDate, formatDateTime, formatMonthLabel } from '@/lib/utils';
import { ISalary, salaryCompanyLogo, salaryCompanyName, salaryEmployee } from '@/services/salary.services';

interface SalaryDetailsProps {
    salary: ISalary;
    /** Admin view: also show employee, email delivery status. Employee slips hide these. */
    admin?: boolean;
}

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <span className="text-charcoal/55">{label}</span>
        <span className={strong ? 'font-bold text-charcoal' : 'font-medium text-charcoal'}>{value}</span>
    </div>
);

const Items = ({ title, items, currency, sign }: { title: string; items: ISalary['allowances']; currency: string; sign: '+' | '-' }) =>
    items?.length ? (
        <div>
            <h4 className="mb-2 text-sm font-semibold text-charcoal">{title}</h4>
            <div className="space-y-1.5">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-charcoal/[0.03] px-4 py-2.5">
                        <span className="text-sm text-charcoal/60">{item.name}</span>
                        <span className="text-sm font-semibold">{sign} {formatCurrency(item.amount, currency)}</span>
                    </div>
                ))}
            </div>
        </div>
    ) : null;

const SalaryDetails = ({ salary, admin = false }: SalaryDetailsProps) => {
    const employee = salaryEmployee(salary);
    const logo = salaryCompanyLogo(salary);
    const payment = salary.paymentDetails;
    const hasPayment = payment && Object.values(payment).some(Boolean);
    const paidBy = typeof salary.paidBy === 'object' ? salary.paidBy?.name : salary.paidByName;

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    {logo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt="" className="size-11 shrink-0 rounded-lg border border-charcoal/5 bg-white object-contain p-1" onError={e => (e.currentTarget.style.display = 'none')} />
                    )}
                    <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold font-heading">
                            {admin ? employee?.name || 'Employee' : salaryCompanyName(salary) || 'Salary slip'}
                        </h3>
                        <p className="truncate text-sm text-charcoal/45">
                            {admin ? employee?.email : `${formatMonthLabel(salary.month)}`}
                        </p>
                    </div>
                </div>
                <StatusBadge status={salary.status} variant="salary" />
            </div>

            <div className="rounded-xl border border-charcoal/5 bg-charcoal/[0.02] px-4 py-2 divide-y divide-charcoal/5">
                {admin && <Row label="Company" value={salaryCompanyName(salary) || '-'} />}
                <Row label="Month" value={formatMonthLabel(salary.month)} />
                <Row label="Basic salary" value={formatCurrency(salary.salary, salary.currency)} />
                <Row label="Allowances" value={`+ ${formatCurrency(salary.totalAllowances, salary.currency)}`} />
                <Row label="Gross" value={formatCurrency(salary.grossAmount, salary.currency)} />
                <Row label="Deductions" value={`- ${formatCurrency(salary.totalDeductions, salary.currency)}`} />
                <Row label="Net pay" value={formatCurrency(salary.netPay, salary.currency)} strong />
            </div>

            <Items title="Allowances" items={salary.allowances} currency={salary.currency} sign="+" />
            <Items title="Deductions" items={salary.deductions} currency={salary.currency} sign="-" />

            {salary.status === 'paid' && (
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-charcoal">Payment</h4>
                    <div className="rounded-xl border border-charcoal/5 px-4 py-2 divide-y divide-charcoal/5">
                        <Row label="Paid on" value={formatDate(salary.paidOn)} />
                        {admin && paidBy && <Row label="Paid by" value={paidBy} />}
                        {hasPayment && (
                            <>
                                {payment?.method && <Row label="Method" value={payment.method} />}
                                {payment?.bankName && <Row label="Bank" value={payment.bankName} />}
                                {payment?.holderName && <Row label="Account holder" value={payment.holderName} />}
                                {payment?.accountNumber && <Row label="Account number" value={payment.accountNumber} />}
                                {payment?.iban && <Row label="IBAN" value={payment.iban} />}
                                {payment?.reference && <Row label="Reference" value={payment.reference} />}
                            </>
                        )}
                    </div>
                </div>
            )}

            {admin && salary.status === 'paid' && salary.email && (
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-charcoal">Slip email</h4>
                    <div className="rounded-xl border border-charcoal/5 px-4 py-2 divide-y divide-charcoal/5">
                        <Row label="Status" value={<StatusBadge status={salary.email.status} variant="email" />} />
                        <Row label="Attempts" value={salary.email.attempts} />
                        {salary.email.sentAt && <Row label="Sent at" value={formatDateTime(salary.email.sentAt)} />}
                        {salary.email.lastError && (
                            <p className="py-2 text-xs text-red-600">Last error: {salary.email.lastError}</p>
                        )}
                    </div>
                </div>
            )}

            {salary.notes && (
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-charcoal">Notes</h4>
                    <div className="rounded-xl bg-charcoal/[0.03] p-4 text-sm text-charcoal/60">{salary.notes}</div>
                </div>
            )}
        </div>
    );
};

export default SalaryDetails;
