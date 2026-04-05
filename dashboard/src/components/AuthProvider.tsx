import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import type { User } from '../lib/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, logout: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = () => {
      apiFetch<User>('/auth/me')
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    };
    check();

    const onFocus = () => {
      // Re-validate session when user returns to tab
      // Only clear user on 401 (handled by apiFetch redirect to /login)
      // On network errors, keep current user to avoid false logouts
      apiFetch<User>('/auth/me')
        .then(setUser)
        .catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    window.location.href = '/login';
  };

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}
