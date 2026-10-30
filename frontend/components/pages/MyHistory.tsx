'use client'

import React from 'react'
import EmployeeHistoryTimeline from '../history/EmployeeHistoryTimeline'

// Employee: read-only view of their own career history.
const MyHistory = () => (
    <div className="py-4 lg:py-6">
        <div className="mb-6">
            <h4 className="text-md font-bold font-heading sm:text-xl">My History</h4>
            <p className="mt-1 text-sm text-charcoal/45">Your promotions, salary changes and other career events.</p>
        </div>
        <EmployeeHistoryTimeline mine />
    </div>
)

export default MyHistory
