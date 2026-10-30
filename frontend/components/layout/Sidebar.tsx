"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    FiGrid as LayoutDashboard,
    FiUsers as Users,
    FiCreditCard as WalletCards,
    FiClipboard as ClipboardList,
    FiSettings as Settings,
    FiLogOut as LogOut,
    FiX as X,
    FiHome as Home,
    FiFileText as FileText,
    FiAward as Award,
    FiClock as History,
} from "react-icons/fi";
import { TfiReceipt as Receipt } from "react-icons/tfi";
import {
    FaBuilding as Building2,
    FaRocketchat
} from "react-icons/fa";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { VscProject } from "react-icons/vsc";

const adminNavigation = [
    {
        title: "Overview",
        items: [
            {
                label: "Dashboard",
                href: "/",
                icon: LayoutDashboard,
            },
        ],
    },
    {
        title: "Management",
        items: [
            {
                label: "Employees",
                href: "/employees",
                icon: Users,
            },
            {
                label: "Employee History",
                href: "/employee-history",
                icon: History,
            },
            {
                label: "Expenses",
                href: "/expenses",
                icon: Receipt,
            },
            {
                label: "Projects",
                href: "/projects",
                icon: VscProject,
            },
            {
                label: "Salaries",
                href: "/salaries",
                icon: WalletCards,
            },
            {
                label: "Certificates",
                href: "/certificates",
                icon: Award,
            },
            {
                label: "Companies",
                href: "/companies",
                icon: Home,
            },
            {
                label: "EOD Reports",
                href: "/eod",
                icon: ClipboardList,
            },
            {
                label: "Chats",
                href: "/chat",
                icon: FaRocketchat,
            },
        ],
    },
    // {
    //     title: "Finance",
    //     items: [
    //         {
    //             label: "VAT",
    //             href: "/dashboard/vat",
    //             icon: Percent,
    //         },
    //         {
    //             label: "Corporate Tax",
    //             href: "/dashboard/tax",
    //             icon: Calculator,
    //         },
    //     ],
    // },
];

const employeeNavigation = [
    {
        title: "Overview",
        items: [
            {
                label: "Dashboard",
                href: "/",
                icon: LayoutDashboard,
            },
        ],
    },
    {
        title: "Management",
        items: [
            {
                label: "Projects",
                href: "/projects",
                icon: Receipt,
            },
            {
                label: "My Expenses",
                href: "/expenses",
                icon: WalletCards,
            },
            {
                label: "My Salary",
                href: "/my-salary",
                icon: FileText,
            },
            {
                label: "My Certificates",
                href: "/my-certificates",
                icon: Award,
            },
            {
                label: "My History",
                href: "/my-history",
                icon: History,
            },
            {
                label: "EOD Reports",
                href: "/eod",
                icon: ClipboardList,
            },
            {
                label: "Chats",
                href: "/chat",
                icon: FaRocketchat,
            },
        ],
    },

];

function Sidebar({
    mobileOpen,
    setMobileOpen,
}: {
    mobileOpen: boolean;
    setMobileOpen: (value: boolean) => void;
}) {
    const { logout, role } = useAuth()
    const pathname = usePathname();
    const router = useRouter()
    const [navigation, setNavigation] = useState<any[]>([])

    useEffect(() => {
        if (role === 'employee') {
            setNavigation(employeeNavigation);
        }
        if (role === 'admin') {
            setNavigation(adminNavigation)
        }
    }, [
        role
    ])

    return (
        <>
            {/* Mobile Overlay */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            <aside
                className={`
          fixed inset-y-0 left-0 z-50 flex w-68 flex-col
          border-r border-border bg-charcoal
          transition-transform duration-200 scrollbar-thin!
          lg:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
            >
                {/* Logo */}
                <div className="flex h-20 items-center justify-between border-b border-border px-6">
                    <Link
                        href="/"
                        className="flex items-center gap-3"
                        onClick={() => setMobileOpen(false)}
                    >
                        <div className="flex h-9 w-9 items-center justify-center rounded-button bg-charcoal text-white">
                            <Building2 size={18} strokeWidth={2} />
                        </div>

                        <div>
                            <p className="font-heading text-sm font-bold text-surface">
                                Team & Finance
                            </p>
                            <p className="text-[11px] text-text-muted">
                                Management System
                            </p>
                        </div>
                    </Link>

                    <button
                        type="button"
                        onClick={() => setMobileOpen(false)}
                        className="rounded-button p-2 text-text-secondary hover:bg-surface-soft lg:hidden"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin! scrollbar-thumb-blue-500">
                    {navigation.map((section) => (
                        <div key={section.title} className="mb-7">
                            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                                {section.title}
                            </p>

                            <div className="space-y-1">
                                {section.items.map((item: any) => {
                                    const Icon = item.icon;

                                    const isActive =
                                        pathname === item.href ||
                                        (item.href !== "/dashboard" &&
                                            pathname.startsWith(`${item.href}/`));

                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            onClick={() => setMobileOpen(false)}
                                            className={`
                        group flex items-center gap-3 rounded-button px-3 py-2.5
                        text-sm font-medium transition-colors
                        ${isActive
                                                    ? "bg-emerald-light text-emerald"
                                                    : "text-text-secondary hover:bg-surface-soft hover:text-charcoal"
                                                }
                      `}
                                        >
                                            <Icon
                                                size={18}
                                                strokeWidth={isActive ? 2.2 : 1.8}
                                                className={
                                                    isActive
                                                        ? "text-emerald"
                                                        : "text-text-muted group-hover:text-charcoal"
                                                }
                                            />

                                            <span>{item.label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Bottom */}
                <div className="border-t border-border p-4">
                    {/* <Link
                        href="/dashboard/settings"
                        onClick={() => setMobileOpen(false)}
                        className={`
              flex items-center gap-3 rounded-button px-3 py-2.5
              text-sm font-medium
              ${pathname.startsWith("/dashboard/settings")
                                ? "bg-surface-soft text-charcoal"
                                : "text-text-secondary hover:bg-surface-soft hover:text-charcoal"
                            }
            `}
                    >
                        <Settings size={18} />
                        <span>Settings</span>
                    </Link> */}

                    <button
                        type="button"
                        onClick={() => {
                            logout();
                            router.push('/login')
                        }}
                        className="mt-1 flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-error-light hover:text-error"
                    >
                        <LogOut size={18} />
                        <span>Logout</span>
                    </button>
                </div>
            </aside>
        </>
    );
}

export default Sidebar