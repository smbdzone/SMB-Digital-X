"use client";


import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { useAuth } from "@/context/AuthContext";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { usePathname, useRouter } from "next/navigation";

const AUTH_FREE_ROUTES = ['/login', '/forgot-password']

export default function DashboardShell({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname()
    const router = useRouter()
    const isAuthRoute = AUTH_FREE_ROUTES.includes(pathname)
    const [mobileOpen, setMobileOpen] = useState(false);
    const { token, loading } = useAuth()

    useEffect(() => {
        if (loading) return;
        if (!token && !isAuthRoute) {
            router.replace("/login");
        } else if (token && isAuthRoute) {
            router.replace("/");
        }
    }, [token, loading, pathname, router, isAuthRoute])

    if (isAuthRoute) {
        return <div className="min-h-screen w-full bg-ivory">{children}</div>;
    }


    if (loading) {
        return <LoadingSpinner fullScreen text="Loading dashboard..." />;
    }

    if (!token) {
        return null;
    }
    return (
        <div className="min-h-screen bg-background">
            <Sidebar
                mobileOpen={mobileOpen}
                setMobileOpen={setMobileOpen}
            />

            <div className="lg:pl-68">
                <Navbar setMobileOpen={setMobileOpen} />

                <main className="min-h-[calc(100vh-5rem)] px-4 py-6 sm:px-6 lg:px-8">
                    <div className="mx-auto w-full max-w-[1600px]">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}