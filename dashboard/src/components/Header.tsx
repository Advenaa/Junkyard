import { Link } from 'react-router';
import { useAuth } from './AuthProvider';

export function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-border bg-surface px-6 py-3 flex items-center justify-between">
      <Link to="/" className="font-heading text-xl text-text-primary">Podders</Link>
      <nav className="flex items-center gap-6">
        <Link to="/reports" className="text-text-secondary hover:text-text-primary text-sm">Reports</Link>
        <Link to="/settings" className="text-text-secondary hover:text-text-primary text-sm">Settings</Link>
        {user && (
          <button onClick={logout} className="text-text-secondary hover:text-text-primary text-sm">{user.username}</button>
        )}
      </nav>
    </header>
  );
}
