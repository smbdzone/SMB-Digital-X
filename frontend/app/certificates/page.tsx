'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CertificateManagement from '@/components/pages/CertificateManagement';
import { useAuth } from '@/context/AuthContext';

const page = () => {
    const { role, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && role !== 'admin') router.replace('/');
    }, [role, loading, router]);

    if (role !== 'admin') return null;
    return <CertificateManagement />;
};

export default page
