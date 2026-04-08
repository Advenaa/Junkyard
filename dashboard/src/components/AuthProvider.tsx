import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch, AUTH_EXPIRED_EVENT } from '../lib/api';
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
    const onAuthExpired = () => {
      setUser(null);
      setLoading(false);
      if (window.location.pathname !== '/login') {
        window.history.replaceState({}, '', '/login');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    };

    const onFocus = () => {
      // Re-validate session when user returns to tab.
      // 401s broadcast AUTH_EXPIRED_EVENT so the route guard can redirect cleanly.
      // On network errors, keep current user to avoid false logouts.
      apiFetch<User>('/auth/me')
        .then(setUser)
        .catch(() => {});
    };

    const check = () => {
      apiFetch<User>('/auth/me')
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    window.addEventListener('focus', onFocus);
    check();
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    window.location.href = '/login';
  };

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}
