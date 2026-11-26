'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Input from '@/components/ui/Input';
import ButtonEmerald from '@/components/ui/ButtonEmerald';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { getMyBankDetails, requestBankDetailsChange, type MyBankDetails } from '@/services/auth.services';
import { errorMessage, formatDate } from '@/lib/utils';

const EMPTY = { bankName: '', holderName: '', accountNumber: '', iban: '' };

/**
 * An employee's bank details: shown (shortened) and changed only by request. The current details stay in use
 * until the owner approves the request in the Owner Console.
 */
const BankDetailsPanel = () => {
    const { token } = useAuth();
    const toast = useToast();
    const [data, setData] = useState<MyBankDetails | null>(null);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        try { setData((await getMyBankDetails(token)).data ?? null); } catch (e) { toast.showError(errorMessage(e, 'Could not load your bank details')); }
    }, [token, toast]);
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        getMyBankDetails(token)
            .then(res => { if (!cancelled) setData(res.data ?? null); })
            .catch(e => { if (!cancelled) toast.showError(errorMessage(e, 'Could not load your bank details')); });
        return () => { cancelled = true; };
    }, [token, toast]);

    const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
    const submit = async () => {
        if (!token) return;
        if (!form.holderName.trim()) return toast.showError('Enter the account holder name');
        if (!form.iban.trim() && !form.accountNumber.trim()) return toast.showError('Enter the IBAN or the account number');
        setSaving(true);
        try {
            const res = await requestBankDetailsChange(token, { ...form, method: 'bank' });
            toast.showSuccess(res.message || 'Request sent');
            setOpen(false); setForm(EMPTY); await load();
        } catch (e) {
            toast.showError(errorMessage(e, 'Could not send the request'));
        } finally {
            setSaving(false);
        }
    };

    const c = data?.current;
    return (
        <div className="mb-6 rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm" data-testid="bank-panel">
            <div className="flex items-center justify-between gap-3">
                <h5 className="font-heading text-sm font-bold text-charcoal">Bank details</h5>
                {!open && <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-blue-600 hover:underline">Request a change</button>}
            </div>
            <p className="mt-2 text-sm text-charcoal/70">
                {c && (c.iban || c.accountNumber) ? `${c.bankName || 'Bank'} · ${c.holderName || ''} · ${c.iban || c.accountNumber}` : 'No bank details on file.'}
            </p>
            {data?.pending && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Change requested on {formatDate(data.pending.requestedAt)} ({data.pending.iban || data.pending.accountNumber}). Your current details stay in use until it is approved.
                </p>
            )}
            {!data?.pending && data?.lastDecision && (
                <p className="mt-2 text-xs text-charcoal/50">Last request {data.lastDecision.status} on {formatDate(data.lastDecision.decidedAt)}.</p>
            )}
            {open && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input label="Bank" name="bankName" value={form.bankName} handleChange={set('bankName')} maxLength={100} />
                    <Input label="Account holder" name="holderName" required value={form.holderName} handleChange={set('holderName')} maxLength={100} />
                    <Input label="IBAN" name="iban" value={form.iban} handleChange={set('iban')} maxLength={50} />
                    <Input label="Account number" name="accountNumber" value={form.accountNumber} handleChange={set('accountNumber')} maxLength={50} />
                    <p className="text-xs text-charcoal/50 sm:col-span-2">The owner checks new details with you by phone before approving them.</p>
                    <div className="flex gap-3 sm:col-span-2">
                        <ButtonEmerald onClick={submit} loading={saving}>Send request</ButtonEmerald>
                        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold text-charcoal">Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BankDetailsPanel;
