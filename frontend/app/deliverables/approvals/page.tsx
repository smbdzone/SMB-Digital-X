'use client'

import { Suspense } from 'react'
import PlanApprovals from '@/components/pages/PlanApprovals'
import ApproverOnly from '@/components/deliverables/ApproverOnly'

const page = () => (
    <ApproverOnly>
        {/* useSearchParams (inside PlanApprovals) needs a Suspense boundary */}
        <Suspense fallback={null}>
            <PlanApprovals />
        </Suspense>
    </ApproverOnly>
)

export default page
