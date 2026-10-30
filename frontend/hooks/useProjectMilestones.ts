'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchProjectMilestones, type MilestoneListResponse } from '@/services/milestone.services'
import { errorMessage } from '@/lib/utils'

/** Loads one project's milestones + summary. `reload` refreshes it after any change. */
export function useProjectMilestones(projectId: string) {
    const { token } = useAuth()
    const [data, setData] = useState<MilestoneListResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        if (!token || !projectId) return
        try {
            const response = await fetchProjectMilestones(token, projectId)
            setData(response)
            setError(null)
        } catch (err) {
            setError(errorMessage(err, 'Failed to load milestones'))
        } finally {
            setLoading(false)
        }
    }, [token, projectId])

    useEffect(() => {
        reload()
    }, [reload])

    return { data, loading, error, reload }
}
