'use client';
import AdminDashboard from '@/components/pages/AdminDashboard';
import EmployeeDashboard from '@/components/pages/EmployeeDashboard';
import { useAuth } from '@/context/AuthContext';
import React from 'react'

// Each role gets its own dashboard. The admin one calls /api/dashboard, which is admin-only, so it is
// only rendered once the role is known to be admin (never while the session is still loading).
const page = () => {
    const { role } = useAuth()
    if (role === 'employee') return <EmployeeDashboard />
    if (role === 'admin') return <AdminDashboard />
    return null
}

export default page
