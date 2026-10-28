'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Company, getCompanies } from '@/services/company.services';

/** Loads companies from the backend (they are no longer hard-coded). */
export function useCompanies({ all = false }: { all?: boolean } = {}) {
    const { token } = useAuth();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(false);

    const reload = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const response = await getCompanies(token, all);
            setCompanies(response.data ?? []);
        } catch (error) {
            console.error('Failed to load companies', error);
        } finally {
            setLoading(false);
        }
    }, [token, all]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { companies, loading, reload };
}
