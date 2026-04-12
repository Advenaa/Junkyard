import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from './AuthProvider';
import { apiFetch } from '../lib/api';

export function Header() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; name: string; matchedAlias: string | null; status: string }>
  >([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      setActiveIndex(-1);
      return;
    }
    try {
      const res = await apiFetch<{
        entities: Array<{ id: string; name: string; matchedAlias: string | null; status: string }>;
      }>(`/entities/search?q=${encodeURIComponent(q)}&limit=8`);
      setSearchResults(res.entities);
      setSearchOpen(true);
      setActiveIndex(-1);
    } catch {
      setSearchResults([]);
      setSearchOpen(false);
      setActiveIndex(-1);
    }
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(value);
    }, 300);
  };

  const selectResult = (entityId: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    navigate(`/entities/${entityId}`);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectResult(searchResults[activeIndex].id);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <header className="border-b border-border bg-surface px-6 py-3">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-heading text-xl text-text-primary">
          Podders
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <NavLink
            to="/reports"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`
            }
          >
            Reports
          </NavLink>
          <NavLink
            to="/feed"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`
            }
          >
            Feed
          </NavLink>
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`
            }
          >
            Chat
          </NavLink>
          <NavLink
            to="/search"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`
            }
          >
            Search
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`
            }
          >
            Settings
          </NavLink>
          {/* Entity search */}
          <div className="relative" ref={searchRef}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => {
                if (searchQuery.length >= 2) setSearchOpen(true);
              }}
              placeholder="Search entities..."
              className="w-40 lg:w-56 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-surface border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                {searchResults.map((entity, i) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => selectResult(entity.id)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm transition-colors ${
                      i === activeIndex
                        ? 'bg-surface-raised text-text-primary'
                        : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-text-primary truncate">{entity.name}</div>
                      {entity.matchedAlias && (
                        <div className="text-xs text-text-secondary/70 truncate">aka {entity.matchedAlias}</div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${
                        entity.status === 'active'
                          ? 'bg-accent-green/15 text-accent-green'
                          : 'bg-border/50 text-text-secondary'
                      }`}
                    >
                      {entity.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchOpen && searchResults.length === 0 && searchQuery.length >= 2 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-surface border border-border rounded-lg shadow-lg z-50 px-3 py-3 text-sm text-text-secondary">
                No entities found
              </div>
            )}
          </div>
          {user && (
            <>
              <span className="text-text-secondary text-sm">{user.username}</span>
              <button onClick={logout} className="text-text-tertiary hover:text-text-primary text-sm">
                Logout
              </button>
            </>
          )}
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
          <NavLink
            to="/reports"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            Reports
          </NavLink>
          <NavLink
            to="/feed"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            Feed
          </NavLink>
          <NavLink
            to="/chat"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            Chat
          </NavLink>
          <NavLink
            to="/search"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            Search
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => `text-sm py-2 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            Settings
          </NavLink>
          {user && (
            <>
              <span className="text-text-secondary text-sm py-2">{user.username}</span>
              <button onClick={logout} className="text-text-tertiary hover:text-text-primary text-sm text-left py-2">
                Logout
              </button>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
