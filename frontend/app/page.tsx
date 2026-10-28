'use client';
import AdminDashboard from '@/components/pages/AdminDashboard';
import { useAuth } from '@/context/AuthContext';
import React from 'react'

const page = () => {
    const { role, user } = useAuth()
    if (role === 'employee') {
        return (
            <main className="flex min-h-[calc(100vh-80px)] items-center justify-center bg-[#F8FAFC] px-6">
                <div className="w-full max-w-2xl rounded-2xl border border-blue-100 bg-white p-10 text-center shadow-sm">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                        <span className="text-3xl">👋</span>
                    </div>

                    <h1 className="text-3xl font-semibold tracking-tight text-[#242424]">
                        Welcome back, <span className="text-blue-600">{user?.name}!</span>
                    </h1>

                    <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-gray-500">
                        Hope you’re having a great day. Have a productive day and keep up
                        the good work.
                    </p>

                    <div className="mx-auto mt-8 h-1 w-16 rounded-full bg-blue-500" />
                </div>
            </main>
        )
    } else {
        return (
            <AdminDashboard />
        )
    }

}

export default page