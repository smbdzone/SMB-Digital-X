import React from 'react'
import Link from 'next/link'
import { FiArrowRight } from 'react-icons/fi'

interface SectionHeaderProps {
    title: string
    href?: string
    action?: string
}

export const SectionHeader = ({ title, href, action = 'View all' }: SectionHeaderProps) => (
    <div className="flex items-center justify-between border-b border-charcoal/5 px-5 py-4 sm:px-6">
        <h2 className="font-heading text-sm font-bold text-charcoal sm:text-base">{title}</h2>
        {href && (
            <Link href={href} className="group flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700">
                {action}
                <FiArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
        )}
    </div>
)