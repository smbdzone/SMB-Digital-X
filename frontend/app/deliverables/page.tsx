'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import TodaysPlan from '@/components/pages/TodaysPlan'
import { useAuth } from '@/context/AuthContext'

// Employees plan their day here. The admin does not plan, so the admin goes to the approval queue.
const page = () => {
    const { role, loading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (loading) return
        if (role === 'admin') router.replace('/deliverables/approvals')
        else if (role !== 'employee') router.replace('/login')
    }, [role, loading, router])

    if (role !== 'employee') return null
    // useSearchParams (inside TodaysPlan) needs a Suspense boundary
    return (
        <Suspense fallback={null}>
            <TodaysPlan />
        </Suspense>
    )
}

export default page
