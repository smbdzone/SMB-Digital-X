'use client';
import EODManagement from '@/components/pages/AdminEod';
import EmployeeEOD from '@/components/pages/EmployeeEod';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import React from 'react'

const page = () => {
    const { role } = useAuth()
    const router = useRouter()
    if (role === 'employee') {
        return (
            <div>
                <EmployeeEOD />
            </div>
        )
    } else if (role === 'admin') {
        return (
            <div>
                <EODManagement />
            </div>
        )
    } else {
        router.push('/login')
    }

}

export default page