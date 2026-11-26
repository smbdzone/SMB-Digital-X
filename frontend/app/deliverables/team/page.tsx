'use client'

import TeamDay from '@/components/pages/TeamDay'
import ApproverOnly from '@/components/deliverables/ApproverOnly'

const page = () => (
    <ApproverOnly>
        <TeamDay />
    </ApproverOnly>
)

export default page
