'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DeliverablePerformance from '@/components/pages/DeliverablePerformance'
import { useAuth } from '@/context/AuthContext'

const page = () => {
    const { role, loading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!loading && !role) router.replace('/login')
    }, [role, loading, router])

    if (!role) return null
    return <DeliverablePerformance />
}

export default page
