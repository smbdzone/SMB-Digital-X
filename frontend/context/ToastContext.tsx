"use client";

import { Toast, ToastContainer, ToastType } from '@/components/ui/Toast';
import React, { createContext, useContext, useState, useCallback } from 'react';

interface ToastContextType {
    showToast: (message: string, type?: ToastType, duration?: number) => void;
    showSuccess: (message: string, duration?: number) => void;
    showError: (message: string, duration?: number) => void;
    showWarning: (message: string, duration?: number) => void;
    showInfo: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const showToast = useCallback(
        (message: string, type: ToastType = 'info', duration: number = 3000) => {
            const id = Math.random().toString(36).substring(7);
            const newToast: Toast = { id, message, type, duration };
            setToasts((prev) => [...prev, newToast]);
        },
        []
    );

    const showSuccess = useCallback(
        (message: string, duration?: number) => {
            showToast(message, 'success', duration);
        },
        [showToast]
    );

    const showError = useCallback(
        (message: string, duration?: number) => {
            showToast(message, 'error', duration || 5000);
        },
        [showToast]
    );

    const showWarning = useCallback(
        (message: string, duration?: number) => {
            showToast(message, 'warning', duration);
        },
        [showToast]
    );

    const showInfo = useCallback(
        (message: string, duration?: number) => {
            showToast(message, 'info', duration);
        },
        [showToast]
    );

    return (
        <ToastContext.Provider
            value={{
                showToast,
                showSuccess,
                showError,
                showWarning,
                showInfo,
            }}
        >
            {children}
            <ToastContainer toasts={toasts} onClose={removeToast} />
        </ToastContext.Provider>
    );
};

