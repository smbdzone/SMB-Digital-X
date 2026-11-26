'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { fetchDeliverableAccess } from '@/services/deliverable.services'

/**
 * Can this user approve deliverable plans? (the admin, or an employee the admin flagged)
 *
 * Starts from the login payload (so the menu does not flicker) and then asks the server,
 * because the admin can grant or remove the right while the user stays logged in.
 * The backend checks the flag on every request; this only decides what the UI shows.
 */
export function useDeliverableAccess() {
    const { token, role, user } = useAuth()
    const fromLogin = role === 'admin' || user?.canApproveDeliverables === true
    const [canApprove, setCanApprove] = useState<boolean>(fromLogin)
    const [checked, setChecked] = useState(false)

    useEffect(() => {
        setCanApprove(fromLogin)
    }, [fromLogin])

    useEffect(() => {
        if (!token) return
        let cancelled = false
        fetchDeliverableAccess(token)
            .then(r => { if (!cancelled) setCanApprove(!!r.data?.canApprove) })
            .catch(() => { /* keep the login value; the server still enforces the rule */ })
            .finally(() => { if (!cancelled) setChecked(true) })
        return () => { cancelled = true }
    }, [token])

    return { canApprove, checked, isAdmin: role === 'admin' }
}
