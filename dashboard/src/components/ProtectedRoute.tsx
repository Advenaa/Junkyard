import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading)
    return <div className="min-h-screen flex items-center justify-center text-text-secondary">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'blocked') return <Navigate to="/login" replace />;
  return <Outlet />;
}
