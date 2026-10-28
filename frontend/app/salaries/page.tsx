'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SalaryManagement from '@/components/pages/SalaryManagement';
import { useAuth } from '@/context/AuthContext';

const page = () => {
    const { role, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && role !== 'admin') router.replace('/');
    }, [role, loading, router]);

    if (role !== 'admin') return null;
    return <SalaryManagement />;
};

export default page
