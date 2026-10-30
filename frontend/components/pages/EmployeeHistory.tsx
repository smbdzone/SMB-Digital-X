'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FiSearch } from 'react-icons/fi'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchAllEmployees, type User } from '@/services/auth.services'
import { errorMessage } from '@/lib/utils'
import EmployeeHistoryTimeline from '../history/EmployeeHistoryTimeline'

// Admin: pick an employee, see and manage their career history.
const EmployeeHistory = () => {
    const { token } = useAuth()
    const toast = useToast()
    const router = useRouter()
    const searchParams = useSearchParams()
    const selectedId = searchParams.get('employee') ?? ''

    const [employees, setEmployees] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        if (!token) return
        const load = async () => {
            try {
                const response = await fetchAllEmployees(token)
                setEmployees((response.data ?? []).filter(u => u.role !== 'admin'))
            } catch (error) {
                toast.showError(errorMessage(error, 'Failed to load employees'))
            } finally {
                setLoading(false)
            }
        }
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return employees
        return employees.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
    }, [employees, search])

    const select = (id: string) => router.replace(`/employee-history?employee=${id}`, { scroll: false })

    return (
        <div className="py-4 lg:py-6">
            <div className="mb-6">
                <h4 className="text-md font-bold font-heading sm:text-xl">Employee History</h4>
                <p className="mt-1 text-sm text-charcoal/50">Promotions, salary changes and other career events for each employee.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
                <div className="rounded-2xl border border-charcoal/5 bg-white p-4 shadow-sm">
                    <div className="relative">
                        <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal/40" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search employees"
                            className="h-11 w-full rounded-xl border border-charcoal/10 bg-surface pl-10 pr-3 text-sm text-charcoal outline-none placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        />
                    </div>

                    <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
                        {loading ? (
                            <p className="py-6 text-center text-sm text-charcoal/50">Loading...</p>
                        ) : filtered.length === 0 ? (
                            <p className="py-6 text-center text-sm text-charcoal/50">{employees.length ? 'No employee matches your search.' : 'No employees found.'}</p>
                        ) : (
                            filtered.map(emp => {
                                const active = emp._id === selectedId
                                return (
                                    <button
                                        key={emp._id}
                                        onClick={() => select(emp._id)}
                                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-emerald-light' : 'hover:bg-charcoal/[0.03]'}`}
                                    >
                                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'}`}>
                                            {emp.name.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="min-w-0">
                                            <span className={`block truncate text-sm font-semibold ${active ? 'text-emerald' : 'text-charcoal'}`}>{emp.name}</span>
                                            <span className="block truncate text-xs text-charcoal/45">{emp.position || emp.email}</span>
                                        </span>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>

                <div className="min-w-0">
                    {selectedId ? (
                        <EmployeeHistoryTimeline key={selectedId} employeeId={selectedId} canEdit />
                    ) : (
                        <div className="rounded-2xl border border-dashed border-charcoal/10 bg-white px-5 py-16 text-center">
                            <h5 className="font-semibold text-charcoal">Select an employee</h5>
                            <p className="mt-1 text-sm text-charcoal/45">Choose someone from the list to see and manage their history.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default EmployeeHistory
