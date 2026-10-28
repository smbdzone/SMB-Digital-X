'use client';

import React, { useState } from 'react';
import { FiDelete, FiEdit, FiPlus, FiTrash2 } from 'react-icons/fi';

import ModalBox from '../ui/ModalBox';
import ButtonEmerald from '../ui/ButtonEmerald';
import Input from '../ui/Input';
import { TextAreaField } from '@/components/ui/shared';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useCompanies } from '@/hooks/useCompanies';
import { Company, CompanyPayload, createCompany, deleteCompany, updateCompany } from '@/services/company.services';
import { errorMessage } from '@/lib/utils';

interface CompanyForm {
    name: string;
    code: string;
    legalName: string;
    logo: string;
    brandColor: string;
    address: string;
    phone: string;
    website: string;
    currency: string;
    isActive: boolean;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    footerNote: string;
    signatoryName: string;
    signatoryTitle: string;
    signature: string;
}

const emptyForm: CompanyForm = {
    name: '', code: '', legalName: '', logo: '', brandColor: '#0136B0', address: '', phone: '', website: '',
    currency: 'AED', isActive: true, fromName: '', fromEmail: '', replyTo: '', footerNote: '',
    signatoryName: '', signatoryTitle: '', signature: '',
};

const toForm = (c: Company): CompanyForm => ({
    name: c.name, code: c.code, legalName: c.legalName ?? '', logo: c.logo ?? '', brandColor: c.brandColor || '#0136B0',
    address: c.address ?? '', phone: c.phone ?? '', website: c.website ?? '', currency: c.currency || 'AED', isActive: c.isActive,
    fromName: c.email?.fromName ?? '', fromEmail: c.email?.fromEmail ?? '', replyTo: c.email?.replyTo ?? '', footerNote: c.email?.footerNote ?? '',
    signatoryName: c.signatory?.name ?? '', signatoryTitle: c.signatory?.title ?? '', signature: c.signatory?.signature ?? '',
});

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
    <div className="space-y-4">
        <div>
            <h5 className="text-sm font-semibold text-charcoal">{title}</h5>
            {hint && <p className="mt-0.5 text-xs text-charcoal/50">{hint}</p>}
        </div>
        {children}
    </div>
);

const Companies = () => {
    const { token } = useAuth();
    const toast = useToast();
    const { companies, loading, reload } = useCompanies({ all: true });

    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Company | null>(null);
    const [form, setForm] = useState<CompanyForm>(emptyForm);
    const [saving, setSaving] = useState(false);

    const [selectedImage, setSelectedImage] = useState<File | null>(null)


    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setForm(prev => ({
                ...prev,
                logo: URL.createObjectURL(file)
            }))
            setSelectedImage(file)
        }

    }

    const set = <K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => setForm(f => ({ ...f, [key]: value }));
    const text = (key: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value as never);

    const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
    const openEdit = (company: Company) => { setEditing(company); setForm(toForm(company)); setOpen(true); };
    const close = () => { setOpen(false); setEditing(null); };


    const handleSave = async () => {
        if (!token) return;
        if (!form.name.trim()) return toast.showError('Company name is required');
        if (!editing && !/^[a-z0-9-]+$/.test(form.code.trim().toLowerCase())) {
            return toast.showError('Code may contain only lowercase letters, numbers and dashes');
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(form.brandColor)) return toast.showError('Brand colour must look like #0136B0');
        if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return toast.showError('Currency must be a 3-letter code, for example AED');


        const formData: any = new FormData();
        formData.append('name', form.name.trim());
        formData.append('legalName', form.legalName.trim());
        formData.append('brandColor', form.brandColor);
        formData.append('address', form.address.trim());
        formData.append('phone', form.phone.trim());
        formData.append('website', form.website.trim());
        formData.append('currency', form.currency.trim().toUpperCase());
        formData.append('isActive', String(form.isActive));
        formData.append('email[fromName]', form.fromName.trim());
        formData.append('email[fromEmail]', form.fromEmail.trim());
        formData.append('email[replyTo]', form.replyTo.trim());
        formData.append('email[footerNote]', form.footerNote.trim());
        formData.append('code', String(form.code))

        formData.append('signatory[name]', form.signatoryName.trim());
        formData.append('signatory[title]', form.signatoryTitle.trim());
        formData.append('signatory[signature]', form.signature.trim());
        if (selectedImage) {
            formData.append('logo', selectedImage)
        } else if (editing && form.logo) {
            formData.append('logo', form.logo)
        }

        const payload: CompanyPayload = {
            name: form.name.trim(),
            legalName: form.legalName.trim(),
            logo: form.logo.trim(),
            brandColor: form.brandColor,
            address: form.address.trim(),
            phone: form.phone.trim(),
            website: form.website.trim(),
            currency: form.currency.trim().toUpperCase(),
            isActive: form.isActive,
            email: {
                fromName: form.fromName.trim(),
                fromEmail: form.fromEmail.trim(),
                replyTo: form.replyTo.trim(),
                footerNote: form.footerNote.trim(),
            },
            signatory: {
                name: form.signatoryName.trim(),
                title: form.signatoryTitle.trim(),
                signature: form.signature.trim(),
            },
        };

        setSaving(true);
        try {
            if (editing) {
                await updateCompany(token, editing._id, formData);
                toast.showSuccess('Company updated');
            } else {
                await createCompany(token, formData);
                toast.showSuccess('Company created');
            }
            close();
            await reload();
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to save company'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!token) return;
        try {
            const confirmMsg = confirm('Are you sure to delete company its not reverted')
            if (confirmMsg) {
                await deleteCompany(token, id)
                toast.showSuccess('Company Deleted');
                reload()
            }
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to delete company'));
        }
    }

    const toggleActive = async (company: Company) => {
        if (!token) return;
        const next = !company.isActive;
        if (!next && !confirm(`Deactivate ${company.name}? It will no longer be selectable, but past salaries and expenses keep working.`)) return;
        try {
            await updateCompany(token, company._id, { isActive: next });
            toast.showSuccess(next ? 'Company activated' : 'Company deactivated');
            await reload();
        } catch (error) {
            toast.showError(errorMessage(error, 'Failed to update company'));
        }
    };

    return (
        <>
            <div className="flex items-center justify-between py-4 lg:py-6">
                <div>
                    <h4 className="text-md font-bold font-heading sm:text-xl">Companies</h4>
                    <p className="mt-1 text-sm text-charcoal/45">Branding and email settings used on salary slips.</p>
                </div>
                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openCreate}>Add company</ButtonEmerald>
            </div>

            {loading && !companies.length ? (
                <p className="py-10 text-center text-sm text-charcoal/50">Loading...</p>
            ) : companies.length === 0 ? (
                <p className="py-10 text-center text-sm text-charcoal/50">No companies yet. Run the backend migration or add one.</p>
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
                                        <p className="truncate text-xs text-charcoal/45">{company.code}</p>
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
                                <div className="flex items-center gap-1">
                                    <button onClick={() => toggleActive(company)} className="rounded-lg px-3 py-2 text-xs font-semibold text-charcoal/60 transition hover:bg-charcoal/5">
                                        {company.isActive ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button onClick={() => openEdit(company)} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50" title="Edit"><FiEdit className="size-4" /></button>
                                    <button onClick={() => handleDelete(company._id)} className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40" title="Delete"><FiTrash2 className="size-4" /></button>

                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ModalBox
                open={open}
                onClose={close}
                size="4xl"
                title={editing ? `Edit ${editing.name}` : 'Add company'}
                footer={
                    <>
                        <button onClick={close} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                        <ButtonEmerald onClick={handleSave} loading={saving} className="!h-11">{editing ? 'Save changes' : 'Create company'}</ButtonEmerald>
                    </>
                }
            >
                <div className="space-y-8">
                    <Section title="Company">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Input label="Name" required value={form.name} handleChange={text('name')} placeholder="Shown on slips and as sender name" />
                            <Input label="Code" required={!editing} disabled={!!editing} value={form.code} handleChange={e => set('code', e.target.value.toLowerCase())} placeholder="smb-proptech" helperText={editing ? 'The code cannot be changed.' : 'Lowercase letters, numbers and dashes'} />
                            <Input label="Legal name" value={form.legalName} handleChange={text('legalName')} />
                            <Input label="Default currency" maxLength={3} value={form.currency} handleChange={e => set('currency', e.target.value.toUpperCase())} />
                            <Input label="Address" value={form.address} handleChange={text('address')} containerClassName="sm:col-span-2" />
                            <Input label="Phone" value={form.phone} handleChange={text('phone')} />
                            <Input label="Website" value={form.website} handleChange={text('website')} placeholder="https://" />
                        </div>
                    </Section>

                    <Section title="Branding" hint="Email apps load the logo from the internet, so use a public URL. A path such as /images/axis-aura.png is resolved against your frontend URL.">
                        <div className="grid gap-4 sm:grid-cols-[200px_0.5fr_200px]">
                            <div>
                                <label className="mb-2 block text-sm font-medium text-charcoal">Choose Company Logo(only png,jpg)</label>

                                <input
                                    type="file"
                                    name='logo'
                                    accept='image/png,image/jpg,.png,.jpg'
                                    // accept={RECEIPT_TYPES.join(",")}
                                    placeholder='Choose Logo '
                                    onChange={handleFileChange}
                                    className="block w-full text-sm text-charcoal/60 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                />
                            </div>
                            {form.logo &&
                                <div className='w-30 h-30 rounded-xl bg-gray-200'>
                                    <img src={form.logo} alt="" className='w-full h-full object-contain' />
                                </div>}
                            {/* <Input label="Logo" value={form.logo} handleChange={text('logo')} placeholder="/images/company.png or https://..." /> */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-charcoal">Brand colour</label>
                                <div className="flex items-center gap-2">
                                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.brandColor) ? form.brandColor : '#0136B0'} onChange={e => set('brandColor', e.target.value)} className="h-11 w-12 cursor-pointer rounded-xl border border-charcoal/10 bg-white p-1" aria-label="Pick brand colour" />
                                    <Input value={form.brandColor} handleChange={text('brandColor')} placeholder="#0136B0" />
                                </div>
                            </div>
                        </div>
                    </Section>

                    <Section title="Slip email" hint="Gmail only sends from your own address or a verified alias. Any other sender email is replaced by the default account, but the display name still changes.">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Input label="Sender name" value={form.fromName} handleChange={text('fromName')} placeholder="Defaults to the company name" />
                            <Input label="Sender email" type="email" value={form.fromEmail} handleChange={text('fromEmail')} />
                            <Input label="Reply-to email" type="email" value={form.replyTo} handleChange={text('replyTo')} />
                            <Input label="Footer note" value={form.footerNote} handleChange={text('footerNote')} placeholder="Shown at the bottom of every slip" />
                        </div>
                    </Section>

                    <Section title="Approved by" hint="Printed as the signatory on salary slips.">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <Input label="Name" value={form.signatoryName} handleChange={text('signatoryName')} />
                            <Input label="Title" value={form.signatoryTitle} handleChange={text('signatoryTitle')} />
                            <Input label="Signature text" value={form.signature} handleChange={text('signature')} />
                        </div>
                    </Section>

                    <label className="flex cursor-pointer items-center gap-3 text-sm text-charcoal">
                        <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="size-4 accent-blue-600" />
                        Active, available when assigning employees, salaries and expenses
                    </label>
                </div>
            </ModalBox>
        </>
    );
};

export default Companies;
