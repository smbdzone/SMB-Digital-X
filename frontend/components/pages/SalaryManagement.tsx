'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiCheckCircle, FiEdit, FiEye, FiMail, FiPlay } from 'react-icons/fi';

import ModalBox from '../ui/ModalBox';
import ButtonEmerald from '../ui/ButtonEmerald';
import Input from '../ui/Input';
import SelectField from '../ui/SelectField';
import Pagination from '../ui/Pagination';
import LineItemsEditor from '../salary/LineItemsEditor';
import SalaryDetails from '../salary/SalaryDetails';

import {
    ISalary,
    LineItem,
    SalarySummaryRow,
    Pagination as PaginationData,
    UpdateSalaryPayload,
    bulkPaySalaries,
    generateSalaries,
    getSalaries,
    resendSalaryEmail,
    salaryCompanyId,
    salaryCompanyLogo,
    salaryCompanyName,
    salaryEmployee,
    updateSalary,
} from '@/services/salary.services';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useCompanies } from '@/hooks/useCompanies';
import { StatusBadge, SummaryCard, TextAreaField } from '@/components/ui/shared';
import { currentMonth, errorMessage, formatCurrency, formatDate, formatMonthLabel } from '@/lib/utils';

const PAGE_SIZE = 25;
const PAYMENT_METHODS = ['Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];

interface EditForm {
    salary: string;
    currency: string;
    companyId: string;
    allowances: LineItem[];
    deductions: LineItem[];
    notes: string;
}

interface PayForm {
    paymentMethod: string;
    bankName: string;
    holderName: string;
    accountNumber: string;
    iban: string;
    paymentReference: string;
}

const emptyPay: PayForm = {
    paymentMethod: 'Bank transfer',
    bankName: '',
    holderName: '',
    accountNumber: '',
    iban: '',
    paymentReference: '',
};

const sumItems = (items: LineItem[]) => items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

// "AED 1,000.00 + USD 200.00" (never add different currencies together)
const totalsText = (rows: SalarySummaryRow[]) =>
    rows.length ? rows.map(r => formatCurrency(r.netPay, r.currency)).join(' + ') : 'No records';

const SalaryManagement = () => {
    const { token } = useAuth();
    const toast = useToast();
    const { companies } = useCompanies();

    const [month, setMonth] = useState(currentMonth());
    const [companyFilter, setCompanyFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'paid'>('');
    const [page, setPage] = useState(1);

    const [salaries, setSalaries] = useState<ISalary[]>([]);
    const [pagination, setPagination] = useState<PaginationData | null>(null);
    const [summary, setSummary] = useState<SalarySummaryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [viewSalary, setViewSalary] = useState<ISalary | null>(null);
    const [editTarget, setEditTarget] = useState<ISalary | null>(null);
    const [editForm, setEditForm] = useState<EditForm | null>(null);
    const [payTarget, setPayTarget] = useState<ISalary | null>(null);
    const [payForm, setPayForm] = useState<PayForm>(emptyPay);

    const loadSalaries = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const response = await getSalaries(token, {
                month,
                status: statusFilter,
                companyId: companyFilter,
                page,
                limit: PAGE_SIZE,
            });
            setSalaries(response.data ?? []);
            setPagination(response.pagination ?? null);
            setSummary(response.summary ?? []);
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to fetch salaries'));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, month, statusFilter, companyFilter, page]);

    useEffect(() => {
        loadSalaries();
    }, [loadSalaries]);

    const pending = useMemo(() => summary.filter(r => r.status === 'pending'), [summary]);
    const paid = useMemo(() => summary.filter(r => r.status === 'paid'), [summary]);
    const countOf = (rows: SalarySummaryRow[]) => rows.reduce((total, r) => total + r.count, 0);

    const companyOptions = companies.map(c => ({ value: c._id, label: c.name }));
    const selectedCompanyName = companies.find(c => c._id === companyFilter)?.name;

    /* ---------------- generate / bulk pay ---------------- */

    const handleGenerate = async () => {
        if (!token) return;
        setBusy(true);
        try {
            const response = await generateSalaries(token, { month, companyId: companyFilter || undefined });
            toast.showSuccess(response.message || 'Salaries generated');
            const skipped = response.data?.skipped ?? [];
            if (skipped.length) {
                const names = skipped.slice(0, 3).map(s => `${s.name} (${s.reason})`).join(', ');
                toast.showWarning(`${skipped.length} employee(s) skipped: ${names}${skipped.length > 3 ? '...' : ''}`, 8000);
            }
            await loadSalaries();
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to generate salaries'));
        } finally {
            setBusy(false);
        }
    };

    const handleBulkPay = async () => {
        if (!token) return;
        const scope = selectedCompanyName ? ` for ${selectedCompanyName}` : '';
        if (!confirm(`Mark all pending salaries${scope} for ${formatMonthLabel(month)} as paid and email the slips?`)) return;
        setBusy(true);
        try {
            const response = await bulkPaySalaries(token, { month, companyId: companyFilter || undefined });
            const failed = response.data?.emailsFailed ?? 0;
            if (failed > 0) toast.showWarning(response.message || 'Paid, but some emails failed', 8000);
            else toast.showSuccess(response.message || 'Salaries paid');
            await loadSalaries();
        } catch (error) {
            toast.showError(errorMessage(error, 'Bulk payment failed'));
        } finally {
            setBusy(false);
        }
    };

    /* ---------------- pay one ---------------- */

    const openPay = (salary: ISalary) => {
        setPayTarget(salary);
        setPayForm({ ...emptyPay, ...Object.fromEntries(Object.entries(salary.paymentDetails ?? {}).map(([k, v]) => [k === 'method' ? 'paymentMethod' : k === 'reference' ? 'paymentReference' : k, v ?? ''])) });
    };

    const handlePay = async () => {
        if (!token || !payTarget) return;
        setBusyId(payTarget._id);
        try {
            const payload: UpdateSalaryPayload = { status: 'paid' };
            (Object.keys(payForm) as (keyof PayForm)[]).forEach(key => {
                const value = payForm[key].trim();
                if (value) payload[key] = value;
            });
            const response = await updateSalary(token, payTarget._id, payload);
            if (response.email?.status === 'failed') toast.showWarning(response.message || 'Paid, but the slip email failed', 8000);
            else toast.showSuccess(response.message || 'Salary marked as paid');
            setPayTarget(null);
            await loadSalaries();
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to mark salary as paid'));
        } finally {
            setBusyId(null);
        }
    };

    /* ---------------- edit ---------------- */

    const openEdit = (salary: ISalary) => {
        setEditTarget(salary);
        setEditForm({
            salary: String(salary.salary ?? ''),
            currency: salary.currency,
            companyId: salaryCompanyId(salary),
            allowances: (salary.allowances ?? []).map(i => ({ ...i })),
            deductions: (salary.deductions ?? []).map(i => ({ ...i })),
            notes: salary.notes ?? '',
        });
    };

    const handleUpdate = async () => {
        if (!token || !editTarget || !editForm) return;
        const locked = editTarget.status === 'paid'; // paid salaries: only notes can change
        let payload: UpdateSalaryPayload;

        if (locked) {
            payload = { notes: editForm.notes };
        } else {
            const basic = Number(editForm.salary);
            if (!Number.isFinite(basic) || basic < 0) return toast.showError('Enter a valid basic salary');
            if (!/^[A-Za-z]{3}$/.test(editForm.currency.trim())) return toast.showError('Currency must be a 3-letter code, for example AED');
            if (!editForm.companyId) return toast.showError('Select a company');
            const clean = (items: LineItem[]) => items.filter(i => i.name.trim() || Number(i.amount)).map(i => ({ name: i.name.trim(), amount: Number(i.amount) || 0 }));
            const allowances = clean(editForm.allowances);
            const deductions = clean(editForm.deductions);
            if ([...allowances, ...deductions].some(i => !i.name)) return toast.showError('Give every allowance and deduction a name');
            payload = {
                salary: basic,
                currency: editForm.currency.trim().toUpperCase(),
                companyId: editForm.companyId,
                allowances,
                deductions,
                notes: editForm.notes,
            };
        }

        setBusyId(editTarget._id);
        try {
            const response = await updateSalary(token, editTarget._id, payload);
            toast.showSuccess(response.message || 'Salary updated');
            setEditTarget(null);
            setEditForm(null);
            await loadSalaries();
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to update salary'));
        } finally {
            setBusyId(null);
        }
    };

    const handleResend = async (salary: ISalary) => {
        if (!token) return;
        setBusyId(salary._id);
        try {
            const response = await resendSalaryEmail(token, salary._id);
            toast.showSuccess(response.message || 'Salary slip emailed');
        } catch (error) {
            toast.showError(errorMessage(error, 'Email failed'), 8000);
        } finally {
            setBusyId(null);
            await loadSalaries();
        }
    };

    /* ---------------- live net-pay preview in the edit form ---------------- */

    const preview = useMemo(() => {
        if (!editForm) return null;
        const basic = Number(editForm.salary) || 0;
        const allowances = sumItems(editForm.allowances);
        const deductions = sumItems(editForm.deductions);
        return { gross: basic + allowances, deductions, net: basic + allowances - deductions };
    }, [editForm]);

    const editCompanyOptions = useMemo(() => {
        if (!editTarget) return companyOptions;
        const id = salaryCompanyId(editTarget);
        // keep the current company selectable even if it was deactivated later
        return companyOptions.some(o => o.value === id)
            ? companyOptions
            : [...companyOptions, { value: id, label: `${salaryCompanyName(editTarget) || 'Current company'} (inactive)` }];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companies, editTarget]);

    const pendingOnPage = salaries.some(s => s.status === 'pending');
    const hasPending = countOf(pending) > 0 || pendingOnPage;

    const th = 'px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500';

    return (
        <>
            {/* Header */}
            <div className="flex flex-col gap-4 py-4 lg:py-6 xl:flex-row xl:items-center xl:justify-between">
                <div>
                    <h4 className="text-md font-bold font-heading sm:text-xl">Salary Management</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Generate payroll, review it, then pay. Slips are emailed from each company.</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-charcoal/50">Month</label>
                        <input
                            type="month"
                            value={month}
                            onChange={e => { setMonth(e.target.value || currentMonth()); setPage(1); }}
                            className="h-11 rounded-xl border border-charcoal/10 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        />
                    </div>
                    <div className="w-44">
                        <label className="mb-1 block text-xs font-medium text-charcoal/50">Company</label>
                        <SelectField value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setPage(1); }} options={companyOptions} placeholder="All companies" />
                    </div>
                    <div className="w-36">
                        <label className="mb-1 block text-xs font-medium text-charcoal/50">Status</label>
                        <SelectField
                            value={statusFilter}
                            onChange={e => { setStatusFilter(e.target.value as '' | 'pending' | 'paid'); setPage(1); }}
                            options={[{ value: 'pending', label: 'Pending' }, { value: 'paid', label: 'Paid' }]}
                            placeholder="All"
                        />
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="mb-5 flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={busy}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-charcoal/10 bg-white px-4 text-sm font-semibold text-charcoal transition hover:bg-charcoal/[0.03] disabled:opacity-50"
                >
                    <FiPlay className="size-4" /> Generate {formatMonthLabel(month)}
                </button>
                <ButtonEmerald icon={<FiCheckCircle className="size-4" />} onClick={handleBulkPay} disabled={busy || !hasPending} className="!h-11">
                    Pay all pending
                </ButtonEmerald>
            </div>

            {/* Summary (per currency, from the backend so it covers every page) */}
            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard title="Records" value={countOf(summary)} subtitle={`${formatMonthLabel(month)}${selectedCompanyName ? `, ${selectedCompanyName}` : ''}`} />
                <SummaryCard title="Pending" value={countOf(pending)} subtitle={totalsText(pending)} />
                <SummaryCard title="Paid" value={countOf(paid)} subtitle={totalsText(paid)} />
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className={th}>Employee</th>
                            <th className={th}>Company</th>
                            <th className={th}>Basic</th>
                            <th className={th}>Net pay</th>
                            <th className={th}>Status</th>
                            <th className={th}>Slip email</th>
                            <th className={th}>Paid on</th>
                            <th className={th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading && !salaries.length ? (
                            <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : salaries.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-500">
                                    No salary records for {formatMonthLabel(month)}. Use “Generate” to create them from employee salaries.
                                </td>
                            </tr>
                        ) : (
                            salaries.map(salary => {
                                const employee = salaryEmployee(salary);
                                const logo = salaryCompanyLogo(salary);
                                const rowBusy = busyId === salary._id;
                                return (
                                    <tr key={salary._id} className={rowBusy ? 'opacity-60' : ''}>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <p className="font-medium text-gray-900">{employee?.name || 'Unknown'}</p>
                                            <p className="mt-0.5 text-xs text-gray-400">{employee?.email}</p>
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
                                            <div className="flex items-center gap-2">
                                                {logo && (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={logo} alt="" className="size-6 rounded object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
                                                )}
                                                {salaryCompanyName(salary) || '-'}
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">{formatCurrency(salary.salary, salary.currency)}</td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold">{formatCurrency(salary.netPay, salary.currency)}</td>
                                        <td className="whitespace-nowrap px-5 py-4"><StatusBadge status={salary.status} variant="salary" /></td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            {salary.status === 'paid' && salary.email ? (
                                                <StatusBadge status={salary.email.status} variant="email" />
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">{formatDate(salary.paidOn)}</td>
                                        <td className="whitespace-nowrap px-5 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => setViewSalary(salary)} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50" title="View"><FiEye className="size-4" /></button>
                                                <button onClick={() => openEdit(salary)} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50" title={salary.status === 'paid' ? 'Edit notes' : 'Edit'}><FiEdit className="size-4" /></button>
                                                {salary.status === 'pending' && (
                                                    <button onClick={() => openPay(salary)} disabled={rowBusy} className="rounded-lg p-2 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-40" title="Mark as paid"><FiCheckCircle className="size-4" /></button>
                                                )}
                                                {salary.status === 'paid' && salary.email?.status !== 'sent' && (
                                                    <button onClick={() => handleResend(salary)} disabled={rowBusy} className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-40" title="Resend slip email"><FiMail className="size-4" /></button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            {pagination && <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total} onChange={setPage} disabled={loading} />}

            {/* View */}
            <ModalBox open={!!viewSalary} onClose={() => setViewSalary(null)} size="2xl" title="Salary details">
                {viewSalary && <SalaryDetails salary={viewSalary} admin />}
            </ModalBox>

            {/* Pay */}
            <ModalBox
                open={!!payTarget}
                onClose={() => setPayTarget(null)}
                size="xl"
                title="Mark salary as paid"
                description={payTarget ? `${salaryEmployee(payTarget)?.name ?? ''}, ${formatMonthLabel(payTarget.month)}: ${formatCurrency(payTarget.netPay, payTarget.currency)}. The slip is emailed from ${salaryCompanyName(payTarget)}.` : undefined}
                footer={
                    <>
                        <button onClick={() => setPayTarget(null)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                        <ButtonEmerald onClick={handlePay} loading={!!payTarget && busyId === payTarget._id} className="!h-11">Pay and email slip</ButtonEmerald>
                    </>
                }
            >
                <p className="mb-4 text-xs text-charcoal/50">Payment details are optional and appear on the slip. Once paid, only notes can be edited.</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <SelectField label="Payment method" value={payForm.paymentMethod} onChange={e => setPayForm(f => ({ ...f, paymentMethod: e.target.value }))} options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))} />
                    <Input label="Reference" value={payForm.paymentReference} handleChange={e => setPayForm(f => ({ ...f, paymentReference: e.target.value }))} placeholder="Transfer or cheque number" />
                    <Input label="Bank name" value={payForm.bankName} handleChange={e => setPayForm(f => ({ ...f, bankName: e.target.value }))} />
                    <Input label="Account holder" value={payForm.holderName} handleChange={e => setPayForm(f => ({ ...f, holderName: e.target.value }))} />
                    <Input label="Account number" value={payForm.accountNumber} handleChange={e => setPayForm(f => ({ ...f, accountNumber: e.target.value }))} />
                    <Input label="IBAN" value={payForm.iban} handleChange={e => setPayForm(f => ({ ...f, iban: e.target.value }))} />
                </div>
            </ModalBox>

            {/* Edit */}
            <ModalBox
                open={!!editTarget}
                onClose={() => { setEditTarget(null); setEditForm(null); }}
                size="2xl"
                title={editTarget?.status === 'paid' ? 'Edit notes' : 'Update salary'}
                description={editTarget ? `${salaryEmployee(editTarget)?.name ?? ''}, ${formatMonthLabel(editTarget.month)}` : undefined}
            >
                {editTarget && editForm && preview && (
                    <div className="space-y-5">
                        {editTarget.status === 'paid' ? (
                            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">This salary is already paid, so amounts are locked. You can still edit the notes.</p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <Input label="Basic salary" type="number" min={0} value={editForm.salary} handleChange={e => setEditForm(f => f && { ...f, salary: e.target.value })} />
                                    <Input label="Currency" value={editForm.currency} maxLength={3} handleChange={e => setEditForm(f => f && { ...f, currency: e.target.value.toUpperCase() })} placeholder="AED" />
                                    <SelectField label="Company" value={editForm.companyId} onChange={e => setEditForm(f => f && { ...f, companyId: e.target.value })} options={editCompanyOptions} placeholder="Select company" helperText="Decides the logo and sender of the slip" />
                                </div>
                                <LineItemsEditor label="Allowances" addLabel="Add allowance" namePlaceholder="Allowance name" items={editForm.allowances} onChange={items => setEditForm(f => f && { ...f, allowances: items })} />
                                <LineItemsEditor label="Deductions" addLabel="Add deduction" namePlaceholder="Deduction name" items={editForm.deductions} onChange={items => setEditForm(f => f && { ...f, deductions: items })} />
                                <div className="grid grid-cols-3 gap-3 rounded-xl bg-charcoal/[0.03] p-4 text-sm">
                                    <div><p className="text-xs text-charcoal/45">Gross</p><p className="font-semibold">{formatCurrency(preview.gross, editForm.currency)}</p></div>
                                    <div><p className="text-xs text-charcoal/45">Deductions</p><p className="font-semibold">{formatCurrency(preview.deductions, editForm.currency)}</p></div>
                                    <div><p className="text-xs text-charcoal/45">Net pay</p><p className={`font-bold ${preview.net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatCurrency(preview.net, editForm.currency)}</p></div>
                                </div>
                            </>
                        )}
                        <TextAreaField label="Notes" name="notes" value={editForm.notes} onChange={e => setEditForm(f => f && { ...f, notes: e.target.value })} placeholder="Salary notes..." rows={3} />
                        <div className="flex justify-end gap-3 border-t border-charcoal/5 pt-5">
                            <button onClick={() => { setEditTarget(null); setEditForm(null); }} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                            <ButtonEmerald onClick={handleUpdate} loading={busyId === editTarget._id} className="!h-11">Save changes</ButtonEmerald>
                        </div>
                    </div>
                )}
            </ModalBox>
        </>
    );
};

export default SalaryManagement;
