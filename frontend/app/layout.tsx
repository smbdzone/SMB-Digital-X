import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import DashboardShell from "@/components/layout/DashboardShell";
import { ToastProvider } from "@/context/ToastContext";
import { ChatProvider } from "@/context/ChatContext";




const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Expense Management System",
  description: "Employee, expense, salary and tax management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body data-scroll-behavior="smooth" className={`${inter.variable} ${manrope.variable} antialiased scrollbar-thin! scrollbar-thumb-blue-500!`} >
        <ToastProvider>
          <AuthProvider>

            <ChatProvider>
              <DashboardShell>
                {children}
              </DashboardShell>
            </ChatProvider>

          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}