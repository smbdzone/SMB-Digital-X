import React from 'react'
import Link from 'next/link'
import { FiArrowRight } from 'react-icons/fi'

interface StatCardProps {
    title: string
    value: string | number
    subtitle?: string
    icon: React.ReactNode
    href?: string
}

export const StatCard = ({ title, value, subtitle, icon, href }: StatCardProps) => {
    const content = (
        <div className="group rounded-2xl border border-charcoal/5 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-charcoal/50">{title}</p>
                    <p className="mt-2 font-heading text-2xl font-bold text-charcoal">{value}</p>
                </div>
                <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-500 group-hover:text-white">
                    {icon}
                </div>
            </div>
            {subtitle && (
                <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-charcoal/40">{subtitle}</p>
                    {href && <FiArrowRight className="size-4 text-charcoal/20 transition group-hover:translate-x-1 group-hover:text-blue-500" />}
                </div>
            )}
        </div>
    )
    return href ? <Link href={href}>{content}</Link> : content
}