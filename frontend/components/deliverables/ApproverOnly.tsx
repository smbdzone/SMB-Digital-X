'use client'

import React from 'react'
import { useDeliverableAccess } from '@/hooks/useDeliverableAccess'
import { useAuth } from '@/context/AuthContext'

/** Renders its children only for approvers (the admin and flagged employees). The API enforces the same rule. */
const ApproverOnly = ({ children }: { children: React.ReactNode }) => {
    const { loading, role } = useAuth()
    const { canApprove, checked } = useDeliverableAccess()

    if (loading || !role) return null
    if (!canApprove) {
        if (!checked) return null
        return (
            <div className="py-16 text-center">
                <p className="text-sm text-charcoal/50">This page is for plan approvers.</p>
            </div>
        )
    }
    return <>{children}</>
}

export default ApproverOnly
