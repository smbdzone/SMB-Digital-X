'use client';
import { useAuth } from "@/context/AuthContext";
import {
    FiMenu as Menu,
    FiChevronDown as ChevronDown,
} from "react-icons/fi";
import InstallButton from "./InstallButton";


function Navbar({ setMobileOpen, }: { setMobileOpen: (value: boolean) => void; }) {
    const { user } = useAuth()

    return (
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
            {/* Mobile Menu */}
            <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-button p-2 text-text-secondary hover:bg-surface-soft lg:hidden"
            >
                <Menu size={21} />
            </button>

            {/* Desktop Breadcrumb / Page Area */}
            <div className="hidden lg:block">
                <p className="text-sm font-medium text-charcoal">
                    Financial Management
                </p>
                <p className="text-xs text-text-muted">
                    Manage your business finances
                </p>
            </div>

            {/* Right */}
            <div className="ml-auto flex items-center gap-3">
                {/* Notification */}
                <InstallButton />

                {/* Divider */}
                <div className="hidden h-8 w-px bg-border sm:block" />

                {/* User */}
                <button
                    type="button"
                    className="flex items-center gap-3 rounded-button px-2 py-1.5 hover:bg-surface-soft"
                >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-xs font-semibold text-white">
                        {user?.name.slice(0, 2)}
                    </div>

                    <div className="hidden text-left sm:block">
                        <p className="text-sm font-semibold text-charcoal">
                            {user?.name}
                        </p>
                        <p className="text-[11px] text-text-muted">
                            {user?.role.toUpperCase()}
                        </p>
                    </div>

                    {/* <ChevronDown
                        size={15}
                        className="hidden text-text-muted sm:block"
                    /> */}
                </button>
            </div>
        </header>
    );
}

export default Navbar