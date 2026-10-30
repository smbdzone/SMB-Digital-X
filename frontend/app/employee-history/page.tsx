'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import EmployeeHistory from '@/components/pages/EmployeeHistory'
import { useAuth } from '@/context/AuthContext'

const page = () => {
    const { role, loading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!loading && role !== 'admin') router.replace('/')
    }, [role, loading, router])

    if (role !== 'admin') return null
    // useSearchParams (inside EmployeeHistory) needs a Suspense boundary
    return (
        <Suspense fallback={null}>
            <EmployeeHistory />
        </Suspense>
    )
}

export default page
