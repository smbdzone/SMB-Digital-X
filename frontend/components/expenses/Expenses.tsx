"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FiCheck, FiEdit, FiEye, FiPaperclip, FiPlus, FiSearch, FiTrash2, FiX,
} from "react-icons/fi";

import ModalBox from "@/components/ui/ModalBox";
import ButtonEmerald from "@/components/ui/ButtonEmerald";
import Input from "@/components/ui/Input";
import SelectField from "@/components/ui/SelectField";
import Pagination from "@/components/ui/Pagination";
import { StatusBadge, TextAreaField } from "@/components/ui/shared";

import {
    CreateExpensePayload,
    CurrencyTotal,
    EXPENSE_CATEGORIES,
    EXPENSE_STATUSES,
    Expense,
    ExpenseReceipt,
    ExpenseStatus,
    PAYMENT_METHODS,
    createExpense,
    deleteExpense,
    deleteReceipt,
    expenseCompanyId,
    expenseCompanyName,
    expenseOwnerId,
    expenseOwnerName,
    expenseProject,
    fetchExpenses,
    fetchProjectExpenses,
    updateExpense,
    updateExpenseStatus,
    uploadReceipt,
} from "@/services/expense.services";
import type { Pagination as PaginationData } from "@/services/salary.services";
import { fetchProjects, Project } from "@/services/project.services";
import { fetchProfile } from "@/services/auth.services";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useCompanies } from "@/hooks/useCompanies";
import {
    errorMessage, formatCurrency, formatDate, formatDateTime, getDateOnly, getTodayDate,
} from "@/lib/utils";

interface ExpensesProps {
    projectId?: string;
    /** true = full expenses page (filters, project column). false = compact list inside a project. */
    showProject?: boolean;
    onExpenseChange?: () => void;
}

interface TaxRow {
    name: string;
    percentage: string;
}

interface ExpenseForm {
    projectId: string;
    companyId: string;
    description: string;
    category: string;
    vendor: string;
    paymentMethod: string;
    amount: string;
    currency: string;
    date: string;
    notes: string;
}

const PAGE_SIZE = 20;
const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "PKR", "INR"];
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_RECEIPTS = 5;
const MAX_FILE_MB = 10;

const emptyForm = (projectId = "", companyId = ""): ExpenseForm => ({
    projectId,
    companyId,
    description: "",
    category: "Other",
    vendor: "",
    paymentMethod: "",
    amount: "",
    currency: "AED",
    date: getTodayDate(),
    notes: "",
});

// what an admin can do next, per current status
const STATUS_ACTIONS: Record<ExpenseStatus, { to: ExpenseStatus; label: string; tone: string }[]> = {
    pending: [
        { to: "approved", label: "Approve", tone: "bg-emerald-600 text-white hover:bg-emerald-700" },
        { to: "rejected", label: "Reject", tone: "border border-red-200 text-red-600 hover:bg-red-50" },
    ],
    approved: [
        { to: "reimbursed", label: "Mark reimbursed", tone: "bg-emerald-600 text-white hover:bg-emerald-700" },
        { to: "rejected", label: "Reject", tone: "border border-red-200 text-red-600 hover:bg-red-50" },
        { to: "pending", label: "Back to pending", tone: "border border-charcoal/10 text-charcoal/70 hover:bg-charcoal/[0.03]" },
    ],
    rejected: [
        { to: "approved", label: "Approve", tone: "bg-emerald-600 text-white hover:bg-emerald-700" },
        { to: "pending", label: "Back to pending", tone: "border border-charcoal/10 text-charcoal/70 hover:bg-charcoal/[0.03]" },
    ],
    reimbursed: [
        { to: "pending", label: "Back to pending", tone: "border border-charcoal/10 text-charcoal/70 hover:bg-charcoal/[0.03]" },
    ],
};

const Expenses = ({ projectId, showProject = false, onExpenseChange }: ExpensesProps) => {
    const fullPage = showProject;
    const { token, role, user } = useAuth();
    const toast = useToast();
    const { companies } = useCompanies();

    const isAdmin = role === "admin";
    const myId = String(user?.id ?? user?._id ?? "");

    /* ---------- data ---------- */
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [totals, setTotals] = useState<CurrencyTotal[]>([]);
    const [pagination, setPagination] = useState<PaginationData | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [myCompanyId, setMyCompanyId] = useState("");
    const [loading, setLoading] = useState(false);

    /* ---------- filters (sent to the server) ---------- */
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [companyFilter, setCompanyFilter] = useState("");
    const [projectFilter, setProjectFilter] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [page, setPage] = useState(1);

    /* ---------- modals ---------- */
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Expense | null>(null);
    const [form, setForm] = useState<ExpenseForm>(emptyForm());
    const [taxes, setTaxes] = useState<TaxRow[]>([]);
    const [receipts, setReceipts] = useState<ExpenseReceipt[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [saving, setSaving] = useState(false);

    const [detail, setDetail] = useState<Expense | null>(null);
    const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const [actionId, setActionId] = useState<string | null>(null);

    /* ---------- loading ---------- */
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (!token) return;
        fetchProfile(token)
            .then(r => setMyCompanyId(r.data?.companyId ? String(r.data.companyId) : ""))
            .catch(() => undefined);
        if (fullPage) {
            fetchProjects(token)
                .then(r => setProjects(r.data ?? []))
                .catch(() => undefined);
        }
    }, [token, fullPage]);

    const loadExpenses = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const response = projectId
                ? await fetchProjectExpenses(token, projectId, { page, limit: PAGE_SIZE })
                : await fetchExpenses(token, {
                    search: debouncedSearch,
                    status: statusFilter,
                    category: categoryFilter,
                    companyId: companyFilter,
                    projectId: projectFilter,
                    from,
                    to,
                    page,
                    limit: PAGE_SIZE,
                });
            setExpenses(response.data?.expenses ?? []);
            setTotals(response.data?.totalsByCurrency ?? []);
            setPagination(response.pagination ?? null);
        } catch (error) {
            toast.showError(errorMessage(error, "Failed to load expenses"));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, projectId, debouncedSearch, statusFilter, categoryFilter, companyFilter, projectFilter, from, to, page]);

    useEffect(() => {
        loadExpenses();
    }, [loadExpenses]);

    const afterChange = async () => {
        await loadExpenses();
        onExpenseChange?.();
    };

    const filter = <T,>(setter: (v: T) => void) => (value: T) => {
        setter(value);
        setPage(1);
    };

    const hasFilters = !!(search || statusFilter || categoryFilter || companyFilter || projectFilter || from || to);
    const clearFilters = () => {
        setSearch(""); setStatusFilter(""); setCategoryFilter(""); setCompanyFilter("");
        setProjectFilter(""); setFrom(""); setTo(""); setPage(1);
    };

    /* ---------- permissions & options ---------- */
    const canEdit = (e: Expense) => isAdmin || (expenseOwnerId(e) === myId && e.status === "pending");

    const assignedProjects = useMemo(
        () => (isAdmin ? projects : projects.filter(p => p.employees?.some(emp => emp._id === myId))),
        [projects, isAdmin, myId]
    );
    const projectOptions = assignedProjects.map(p => ({ value: p._id, label: p.name }));
    const companyOptions = companies.map(c => ({ value: c._id, label: c.name }));

    const currencyOptions = useMemo(
        () => Array.from(new Set([...CURRENCIES, form.currency])).filter(Boolean).map(c => ({ value: c, label: c })),
        [form.currency]
    );

    /* ---------- form ---------- */
    const setField = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
    };

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm(projectId ?? "", myCompanyId));
        setTaxes([]);
        setReceipts([]);
        setFiles([]);
        setFormOpen(true);
    };

    const openEdit = (expense: Expense) => {
        const project = expenseProject(expense);
        setEditing(expense);
        setForm({
            projectId: project?.id ?? "",
            companyId: expenseCompanyId(expense),
            description: expense.description,
            category: expense.category,
            vendor: expense.vendor ?? "",
            paymentMethod: expense.paymentMethod ?? "",
            amount: String(expense.amount),
            currency: expense.currency,
            date: getDateOnly(expense.date),
            notes: expense.notes ?? "",
        });
        setTaxes((expense.taxes ?? []).map(t => ({ name: t.name, percentage: String(t.percentage) })));
        setReceipts(expense.receipts ?? []);
        setFiles([]);
        setDetail(null);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
    };

    const taxPreview = useMemo(() => {
        const amount = Number(form.amount) || 0;
        const totalTax = taxes.reduce((sum, t) => sum + (amount * (Number(t.percentage) || 0)) / 100, 0);
        return { totalTax, total: amount + totalTax };
    }, [form.amount, taxes]);

    const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        e.target.value = "";
        const room = MAX_RECEIPTS - receipts.length - files.length;
        const accepted: File[] = [];
        for (const file of picked) {
            if (!RECEIPT_TYPES.includes(file.type)) { toast.showError(`${file.name}: only JPG, PNG, WEBP or PDF files`); continue; }
            if (file.size > MAX_FILE_MB * 1024 * 1024) { toast.showError(`${file.name} is larger than ${MAX_FILE_MB} MB`); continue; }
            if (accepted.length >= room) { toast.showError(`An expense can have at most ${MAX_RECEIPTS} receipts`); break; }
            accepted.push(file);
        }
        if (accepted.length) setFiles(prev => [...prev, ...accepted]);
    };

    const removeReceipt = async (receipt: ExpenseReceipt) => {
        if (!token || !editing || !confirm("Remove this receipt?")) return;
        try {
            const response = await deleteReceipt(token, editing._id, receipt._id);
            setReceipts(response.data ?? receipts.filter(r => r._id !== receipt._id));
            await afterChange();
        } catch (error) {
            toast.showError(errorMessage(error, "Failed to remove receipt"));
        }
    };

    const handleSubmit = async () => {
        if (!token) return;
        const amount = Number(form.amount);
        const needsCompany = !editing || isAdmin;

        if (needsCompany && !form.companyId) return toast.showError("Select the company this expense belongs to");
        if (!form.description.trim()) return toast.showError("Expense description is required");
        if (!form.amount || !Number.isFinite(amount) || amount <= 0) return toast.showError("Amount must be greater than 0");
        if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return toast.showError("Currency must be a 3-letter code, for example AED");
        if (!form.date) return toast.showError("Select the expense date");

        const partial = taxes.some(t => (t.name.trim() === "") !== (t.percentage === ""));
        if (partial) return toast.showError("Fill in both name and percentage for every tax, or remove the row");
        if (taxes.some(t => t.percentage !== "" && (Number(t.percentage) < 0 || Number(t.percentage) > 100))) {
            return toast.showError("Tax percentage must be between 0 and 100");
        }

        const taxPayload = taxes
            .filter(t => t.name.trim() && t.percentage !== "")
            .map(t => ({ name: t.name.trim(), percentage: Number(t.percentage) }));

        const common = {
            description: form.description.trim(),
            category: form.category,
            vendor: form.vendor.trim(),
            ...(form.paymentMethod ? { paymentMethod: form.paymentMethod } : {}), // an empty value is rejected by the API
            amount,
            taxes: taxPayload,
            currency: form.currency.trim().toUpperCase(),
            date: form.date,
            notes: form.notes.trim(),
        };

        setSaving(true);
        try {
            let expenseId = editing?._id ?? "";
            if (editing) {
                // the project of an existing expense cannot be changed; only admins may change its company
                await updateExpense(token, editing._id, { ...common, ...(isAdmin ? { companyId: form.companyId } : {}) });
            } else {
                const payload: CreateExpensePayload = {
                    ...common,
                    companyId: form.companyId,
                    ...(form.projectId ? { projectId: form.projectId } : {}),
                };
                const response = await createExpense(token, payload);
                expenseId = response.data?._id ?? "";
            }

            let failed = 0;
            for (const file of files) {
                try {
                    await uploadReceipt(token, expenseId, file);
                } catch (error) {
                    failed += 1;
                    toast.showError(`${file.name}: ${errorMessage(error, "upload failed")}`);
                }
            }

            toast.showSuccess(editing ? "Expense updated" : isAdmin ? "Expense added and approved" : "Expense submitted for approval");
            if (failed) toast.showWarning(`Expense saved, but ${failed} receipt(s) could not be uploaded. Open it to try again.`, 8000);
            closeForm();
            await afterChange();
        } catch (error) {
            toast.showError(errorMessage(error, "Failed to save expense"));
        } finally {
            setSaving(false);
        }
    };

    /* ---------- status / delete ---------- */
    const changeStatus = async (expense: Expense, status: ExpenseStatus, reason?: string) => {
        if (!token) return;
        setActionId(expense._id);
        try {
            const response = await updateExpenseStatus(token, expense._id, { status, reason });
            toast.showSuccess(response.message || `Expense marked as ${status}`);
            if (detail?._id === expense._id) setDetail(response.data ?? null);
            setRejectTarget(null);
            setRejectReason("");
            await afterChange();
        } catch (error) {
            toast.showError(errorMessage(error, "Failed to update status"));
        } finally {
            setActionId(null);
        }
    };

    const startAction = (expense: Expense, status: ExpenseStatus) => {
        if (status === "rejected") {
            setRejectTarget(expense);
            setRejectReason("");
        } else {
            changeStatus(expense, status);
        }
    };

    const handleDelete = async (expense: Expense) => {
        if (!token || !confirm("Delete this expense? It stays in the audit history but disappears from all lists and totals.")) return;
        setActionId(expense._id);
        try {
            await deleteExpense(token, expense._id);
            toast.showSuccess("Expense deleted");
            setDetail(null);
            await afterChange();
        } catch (error) {
            toast.showError(errorMessage(error, "Failed to delete expense"));
        } finally {
            setActionId(null);
        }
    };

    /* ---------- render ---------- */
    const th = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500";
    const colCount = fullPage ? (isAdmin ? 9 : 7) : 5;

    return (
        <div>
            {/* Header */}
            <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                    <h4 className="font-heading text-md font-bold sm:text-xl">
                        {fullPage ? (isAdmin ? "Expenses" : "My expenses") : "Project expenses"}
                    </h4>
                    {fullPage && !isAdmin && (
                        <p className="mt-1 text-sm text-charcoal/45">New expenses are reviewed by an admin. You can edit them while they are pending.</p>
                    )}
                </div>
                <ButtonEmerald icon={<FiPlus className="size-4" />} onClick={openCreate} className="!h-11">
                    Add expense
                </ButtonEmerald>
            </div>

            {/* Totals (per currency, never mixed) */}
            {fullPage ? (
                <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {totals.length === 0 ? (
                        <div className="rounded-2xl bg-charcoal/[0.025] p-5">
                            <p className="text-sm text-charcoal/50">Total expenses</p>
                            <p className="mt-1 text-2xl font-bold">0.00</p>
                        </div>
                    ) : (
                        totals.map(t => (
                            <div key={t.currency} className="rounded-2xl bg-charcoal/[0.025] p-5">
                                <p className="text-sm text-charcoal/50">Total in {t.currency}</p>
                                <p className="mt-1 text-2xl font-bold">{formatCurrency(t.total, t.currency)}</p>
                                <p className="mt-1 text-xs text-charcoal/40">{t.count} expense{t.count === 1 ? "" : "s"}{statusFilter === "rejected" ? "" : ", rejected excluded"}</p>
                            </div>
                        ))
                    )}
                </div>
            ) : (
                totals.length > 0 && (
                    <p className="mb-4 text-sm text-charcoal/60">
                        Total: <span className="font-semibold text-charcoal">{totals.map(t => formatCurrency(t.total, t.currency)).join(" + ")}</span>
                    </p>
                )
            )}

            {/* Filters */}
            {fullPage && (
                <div className="mb-5 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="relative xl:col-span-2">
                            <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal/40" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search description or vendor"
                                className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                            />
                        </div>
                        <SelectField
                            value={statusFilter}
                            onChange={e => filter(setStatusFilter)(e.target.value)}
                            options={EXPENSE_STATUSES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
                            placeholder="All statuses"
                        />
                        <SelectField
                            value={categoryFilter}
                            onChange={e => filter(setCategoryFilter)(e.target.value)}
                            options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
                            placeholder="All categories"
                        />
                        {isAdmin && (
                            <SelectField value={companyFilter} onChange={e => filter(setCompanyFilter)(e.target.value)} options={companyOptions} placeholder="All companies" />
                        )}
                        <SelectField
                            value={projectFilter}
                            onChange={e => filter(setProjectFilter)(e.target.value)}
                            options={projects.map(p => ({ value: p._id, label: p.name }))}
                            placeholder="All projects"
                        />
                        <div className="flex items-center gap-2 sm:col-span-2">
                            <input type="date" value={from} onChange={e => filter(setFrom)(e.target.value)} aria-label="From date" className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                            <span className="text-xs text-charcoal/40">to</span>
                            <input type="date" value={to} onChange={e => filter(setTo)(e.target.value)} aria-label="To date" className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                        </div>
                    </div>
                    {hasFilters && (
                        <button onClick={clearFilters} className="text-sm font-semibold text-blue-600 hover:text-blue-700">Clear filters</button>
                    )}
                </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto rounded-lg bg-white shadow">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className={th}>Date</th>
                            <th className={th}>Description</th>
                            {fullPage && <th className={th}>Project</th>}
                            {fullPage && isAdmin && <th className={th}>Company</th>}
                            {fullPage && <th className={th}>Category</th>}
                            <th className={th}>Amount</th>
                            <th className={th}>Status</th>
                            {fullPage && isAdmin && <th className={th}>Added by</th>}
                            <th className={th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                        {loading && !expenses.length ? (
                            <tr><td colSpan={colCount} className="px-6 py-8 text-center text-sm text-gray-500">Loading...</td></tr>
                        ) : expenses.length === 0 ? (
                            <tr>
                                <td colSpan={colCount} className="px-6 py-10 text-center text-sm text-gray-500">
                                    {hasFilters ? "No expenses match these filters." : "No expenses yet. Use “Add expense” to record the first one."}
                                </td>
                            </tr>
                        ) : (
                            expenses.map(expense => {
                                const project = expenseProject(expense);
                                const busy = actionId === expense._id;
                                return (
                                    <tr key={expense._id} className={busy ? "opacity-60" : ""}>
                                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{formatDate(expense.date)}</td>
                                        <td className="max-w-[260px] px-4 py-4">
                                            <p className="truncate text-sm font-medium text-gray-900">{expense.description}</p>
                                            {(expense.vendor || expense.receipts?.length > 0) && (
                                                <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-gray-400">
                                                    {expense.vendor}
                                                    {expense.receipts?.length > 0 && (
                                                        <span className="inline-flex items-center gap-1"><FiPaperclip className="size-3" />{expense.receipts.length}</span>
                                                    )}
                                                </p>
                                            )}
                                        </td>
                                        {fullPage && <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{project?.name || <span className="text-gray-400">No project</span>}</td>}
                                        {fullPage && isAdmin && <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{expenseCompanyName(expense) || "-"}</td>}
                                        {fullPage && <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{expense.category}</td>}
                                        <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold">
                                            {formatCurrency(expense.totalAmount, expense.currency)}
                                            {expense.totalTax > 0 && <p className="text-xs font-normal text-gray-400">incl. {formatCurrency(expense.totalTax)} tax</p>}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-4"><StatusBadge status={expense.status} variant="expense" /></td>
                                        {fullPage && isAdmin && <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">{expenseOwnerName(expense) || "-"}</td>}
                                        <td className="whitespace-nowrap px-4 py-4">
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => setDetail(expense)} className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50" title="View"><FiEye className="size-4" /></button>
                                                {isAdmin && expense.status === "pending" && (
                                                    <>
                                                        <button onClick={() => startAction(expense, "approved")} disabled={busy} className="rounded-lg p-2 text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40" title="Approve"><FiCheck className="size-4" /></button>
                                                        <button onClick={() => startAction(expense, "rejected")} disabled={busy} className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-40" title="Reject"><FiX className="size-4" /></button>
                                                    </>
                                                )}
                                                {canEdit(expense) && (
                                                    <button onClick={() => openEdit(expense)} className="rounded-lg p-2 text-charcoal/60 transition hover:bg-charcoal/5" title="Edit"><FiEdit className="size-4" /></button>
                                                )}
                                                {isAdmin && (
                                                    <button onClick={() => handleDelete(expense)} disabled={busy} className="rounded-lg p-2 text-red-600 transition hover:bg-red-50 disabled:opacity-40" title="Delete"><FiTrash2 className="size-4" /></button>
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

            {/* Details */}
            <ModalBox open={!!detail} onClose={() => setDetail(null)} size="2xl" title="Expense details">
                {detail && (
                    <div className="space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="font-heading text-lg font-bold">{detail.description}</h3>
                                <p className="mt-0.5 text-sm text-charcoal/45">{detail.category}{detail.vendor ? `, ${detail.vendor}` : ""}</p>
                            </div>
                            <StatusBadge status={detail.status} variant="expense" />
                        </div>

                        {detail.status === "rejected" && detail.rejectionReason && (
                            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                                <span className="font-semibold">Rejected:</span> {detail.rejectionReason}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 text-sm">
                            {[
                                ["Date", formatDate(detail.date)],
                                ["Company", expenseCompanyName(detail) || "-"],
                                ["Project", expenseProject(detail)?.name || "No project"],
                                ["Added by", expenseOwnerName(detail) || "-"],
                                ["Payment method", PAYMENT_METHODS.find(m => m.value === detail.paymentMethod)?.label ?? "-"],
                                ["Updated", formatDateTime(detail.updatedAt)],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-xl border border-charcoal/5 bg-charcoal/[0.02] p-3">
                                    <p className="text-xs text-charcoal/40">{label}</p>
                                    <p className="mt-0.5 font-medium">{value}</p>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-xl border border-charcoal/5 px-4 py-2 text-sm divide-y divide-charcoal/5">
                            <div className="flex justify-between py-2"><span className="text-charcoal/55">Amount</span><span>{formatCurrency(detail.amount, detail.currency)}</span></div>
                            {detail.taxes?.map((t, i) => (
                                <div key={i} className="flex justify-between py-2"><span className="text-charcoal/55">{t.name} ({t.percentage}%)</span><span>{formatCurrency(t.amount, detail.currency)}</span></div>
                            ))}
                            <div className="flex justify-between py-2 font-bold"><span>Total</span><span>{formatCurrency(detail.totalAmount, detail.currency)}</span></div>
                        </div>

                        {detail.notes && <div className="rounded-xl bg-charcoal/[0.03] p-4 text-sm text-charcoal/60">{detail.notes}</div>}

                        <div>
                            <h4 className="mb-2 text-sm font-semibold">Receipts</h4>
                            {detail.receipts?.length ? (
                                <ul className="space-y-1.5">
                                    {detail.receipts.map(r => (
                                        <li key={r._id}>
                                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl bg-charcoal/[0.03] px-4 py-2.5 text-sm text-blue-700 transition hover:bg-charcoal/[0.06]">
                                                <FiPaperclip className="size-4 shrink-0" />
                                                <span className="truncate">{r.originalName || "Receipt"}</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-charcoal/45">No receipts attached.</p>
                            )}
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t border-charcoal/5 pt-5">
                            {isAdmin && STATUS_ACTIONS[detail.status]?.map(action => (
                                <button
                                    key={action.to}
                                    onClick={() => startAction(detail, action.to)}
                                    disabled={actionId === detail._id}
                                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${action.tone}`}
                                >
                                    {action.label}
                                </button>
                            ))}
                            {canEdit(detail) && (
                                <button onClick={() => openEdit(detail)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-charcoal/[0.03]">Edit</button>
                            )}
                        </div>
                    </div>
                )}
            </ModalBox>

            {/* Reject */}
            <ModalBox
                open={!!rejectTarget}
                onClose={() => setRejectTarget(null)}
                size="md"
                title="Reject expense"
                description="The person who added it will see this reason."
                footer={
                    <>
                        <button onClick={() => setRejectTarget(null)} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                        <button
                            onClick={() => rejectTarget && changeStatus(rejectTarget, "rejected", rejectReason.trim())}
                            disabled={!rejectReason.trim() || actionId === rejectTarget?._id}
                            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                            Reject expense
                        </button>
                    </>
                }
            >
                <TextAreaField label="Reason" name="reason" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="For example: receipt is missing" required rows={3} />
            </ModalBox>

            {/* Add / edit */}
            <ModalBox
                open={formOpen}
                onClose={closeForm}
                size="2xl"
                title={editing ? "Edit expense" : "Add expense"}
                footer={
                    <>
                        <button onClick={closeForm} className="rounded-xl border border-charcoal/10 px-4 py-2.5 text-sm font-semibold">Cancel</button>
                        <ButtonEmerald onClick={handleSubmit} loading={saving} className="!h-11">{editing ? "Save changes" : isAdmin ? "Add expense" : "Submit for approval"}</ButtonEmerald>
                    </>
                }
            >
                <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <SelectField
                            label="Company"
                            name="companyId"
                            required
                            value={form.companyId}
                            onChange={setField}
                            options={companyOptions}
                            placeholder="Select company"
                            disabled={!!editing && !isAdmin}
                            helperText={!isAdmin && myCompanyId ? "Your company is selected by default." : undefined}
                        />
                        <SelectField
                            label="Project"
                            name="projectId"
                            value={form.projectId}
                            onChange={setField}
                            options={projectOptions.length || !projectId ? projectOptions : [{ value: projectId, label: "This project" }]}
                            placeholder="No project (for example rent or utilities)"
                            disabled={!!editing || !!projectId}
                            helperText={editing ? "The project cannot be changed after the expense is created." : undefined}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Input label="Description" name="description" required value={form.description} handleChange={setField} placeholder="AWS hosting, October" />
                        <SelectField label="Category" name="category" value={form.category} onChange={setField} options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))} />
                        <Input label="Vendor" name="vendor" value={form.vendor} handleChange={setField} placeholder="Who was paid" />
                        <SelectField label="Payment method" name="paymentMethod" value={form.paymentMethod} onChange={setField} options={PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))} placeholder="Not specified" />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <Input label="Amount (before tax)" name="amount" type="number" min={0} required value={form.amount} handleChange={setField} placeholder="100" />
                        <SelectField label="Currency" name="currency" value={form.currency} onChange={setField} options={currencyOptions} />
                        <Input label="Date" name="date" type="date" required value={form.date} handleChange={setField} />
                    </div>

                    {/* Taxes */}
                    <div>
                        <div className="mb-3 flex items-center justify-between">
                            <label className="text-sm font-medium text-charcoal">Taxes</label>
                            <button type="button" onClick={() => setTaxes(prev => [...prev, { name: "VAT", percentage: "5" }])} className="text-xs font-semibold text-blue-600 hover:text-blue-700">+ Add tax</button>
                        </div>
                        {taxes.length === 0 ? (
                            <p className="rounded-xl bg-charcoal/[0.03] px-4 py-3 text-xs text-charcoal/45">No tax added.</p>
                        ) : (
                            <div className="space-y-2">
                                {taxes.map((tax, index) => (
                                    <div key={index} className="grid grid-cols-[1fr_110px_36px] items-center gap-2">
                                        <Input value={tax.name} placeholder="Tax name" handleChange={e => setTaxes(prev => prev.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)))} />
                                        <Input type="number" min={0} max={100} value={tax.percentage} placeholder="%" handleChange={e => setTaxes(prev => prev.map((t, i) => (i === index ? { ...t, percentage: e.target.value } : t)))} />
                                        <button type="button" onClick={() => setTaxes(prev => prev.filter((_, i) => i !== index))} className="flex size-9 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50" aria-label="Remove tax"><FiX className="size-4" /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-charcoal/[0.03] p-4 text-sm">
                            <div><p className="text-xs text-charcoal/45">Total tax</p><p className="font-semibold">{formatCurrency(taxPreview.totalTax, form.currency)}</p></div>
                            <div><p className="text-xs text-charcoal/45">Total amount</p><p className="font-bold text-blue-700">{formatCurrency(taxPreview.total, form.currency)}</p></div>
                        </div>
                    </div>

                    {/* Receipts */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-charcoal">Receipts</label>
                        {receipts.length > 0 && (
                            <ul className="mb-2 space-y-1.5">
                                {receipts.map(r => (
                                    <li key={r._id} className="flex items-center justify-between gap-3 rounded-xl bg-charcoal/[0.03] px-4 py-2.5 text-sm">
                                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 text-blue-700">
                                            <FiPaperclip className="size-4 shrink-0" /><span className="truncate">{r.originalName || "Receipt"}</span>
                                        </a>
                                        <button type="button" onClick={() => removeReceipt(r)} className="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {files.length > 0 && (
                            <ul className="mb-2 space-y-1.5">
                                {files.map((f, i) => (
                                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 px-4 py-2.5 text-sm">
                                        <span className="truncate">{f.name} <span className="text-xs text-charcoal/40">(uploads when you save)</span></span>
                                        <button type="button" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-xs font-semibold text-red-600 hover:text-red-700">Remove</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {receipts.length + files.length < MAX_RECEIPTS ? (
                            <input
                                type="file"
                                multiple
                                accept={RECEIPT_TYPES.join(",")}
                                onChange={pickFiles}
                                className="block w-full text-sm text-charcoal/60 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                            />
                        ) : (
                            <p className="text-xs text-charcoal/45">Receipt limit reached ({MAX_RECEIPTS}).</p>
                        )}
                        <p className="mt-1.5 text-xs text-charcoal/45">JPG, PNG, WEBP or PDF, up to {MAX_FILE_MB} MB each, maximum {MAX_RECEIPTS}.</p>
                    </div>

                    <TextAreaField label="Notes" name="notes" value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Anything the approver should know" rows={3} />
                </div>
            </ModalBox>
        </div>
    );
};

export default Expenses;
