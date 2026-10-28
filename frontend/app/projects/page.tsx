'use client'
import EmployeeTasks from '@/components/pages/EmployeeTasks'
import Projects from '@/components/pages/Projects'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import React from 'react'

const page = () => {
    const { role } = useAuth()
    const router = useRouter()
    if (role === 'admin') {
        return (
            <div>
                <Projects />
            </div>
        )
    } else if (role === 'employee') {
        return (
            <div>
                <EmployeeTasks />
            </div>
        )
    } else {
        router.push('/login')
    }

}

export default page