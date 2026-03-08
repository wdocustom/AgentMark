'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = api.getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await api.getMe();
      setUser(res.data);
    } catch {
      api.clearToken();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    await api.login(email, password);
    await checkAuth();
  };

  const register = async (email: string, password: string, name: string, orgName: string) => {
    await api.register(email, password, name, orgName);
    await checkAuth();
  };

  const logout = () => {
    api.clearToken();
    setUser(null);
  };

  return { user, loading, login, register, logout, isAuthenticated: !!user };
}
