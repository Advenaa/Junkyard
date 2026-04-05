import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { useAuth } from './AuthProvider';

export function Header() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-border bg-surface px-6 py-3">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-heading text-xl text-text-primary">Podders</Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <NavLink to="/reports" className={({ isActive }) => `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>Reports</NavLink>
          <NavLink to="/feed" className={({ isActive }) => `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>Feed</NavLink>
          <NavLink to="/chat" className={({ isActive }) => `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>Chat</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>Settings</NavLink>
          {user && (<>
            <span className="text-text-secondary text-sm">{user.username}</span>
            <button onClick={logout} className="text-text-tertiary hover:text-text-primary text-sm">Logout</button>
          </>)}
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-text-secondary hover:text-text-primary"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden mt-3 pt-3 border-t border-border flex flex-col gap-3">
          <NavLink to="/reports" onClick={() => setMenuOpen(false)} className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>Reports</NavLink>
          <NavLink to="/feed" onClick={() => setMenuOpen(false)} className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>Feed</NavLink>
          <NavLink to="/chat" onClick={() => setMenuOpen(false)} className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>Chat</NavLink>
          <NavLink to="/settings" onClick={() => setMenuOpen(false)} className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>Settings</NavLink>
          {user && (<>
            <span className="text-text-secondary text-sm py-2">{user.username}</span>
            <button onClick={logout} className="text-text-tertiary hover:text-text-primary text-sm text-left py-2">Logout</button>
          </>)}
        </nav>
      )}
    </header>
  );
}
