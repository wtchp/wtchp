import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { apiFetch } from "../hooks/useApi";

export function Header({ onMenuToggle }: { onMenuToggle: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);

  // Close menus on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await apiFetch(`/search/suggestions?q=${encodeURIComponent(q)}`);
      if (res.success) setSuggestions(res.data);
    } catch {}
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
    setShowSuggestions(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setShowSuggestions(false);
    }
  };

  return (
    <header className="site-header">
      <div className="header-left">
        <button className="menu-toggle" onClick={onMenuToggle} aria-label="Toggle menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link to="/" className="logo">WTCHP</Link>
      </div>

      <div className="header-center">
        <div className="search-bar" ref={searchRef}>
          <form onSubmit={handleSearch}>
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search videos..."
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            />
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <div className="search-suggestions">
              {suggestions.map((s: any) => (
                <Link
                  key={s.slug}
                  to={`/video/${s.slug}`}
                  onClick={() => { setShowSuggestions(false); setSearchQuery(""); }}
                >
                  {s.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        {/* Theme Toggle */}
        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {user ? (
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <div className="comment-avatar" style={{ width: 32, height: 32, fontSize: "12px" }}>
                {(user.display_name || user.username)[0].toUpperCase()}
              </div>
              <span className="hide-mobile" style={{ fontSize: "var(--font-size-sm)" }}>
                {user.display_name || user.username}
              </span>
            </button>
            {showUserMenu && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-lg)",
                minWidth: "180px",
                zIndex: 100,
                overflow: "hidden"
              }}>
                <Link
                  to="/favorites"
                  className="sidebar-item"
                  onClick={() => setShowUserMenu(false)}
                >
                  <span className="icon">♥</span> Favorites
                </Link>
                <Link
                  to="/history"
                  className="sidebar-item"
                  onClick={() => setShowUserMenu(false)}
                >
                  <span className="icon">⏱</span> History
                </Link>
                {user.role === "admin" && (
                  <Link
                    to="/admin"
                    className="sidebar-item"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <span className="icon">⚙</span> Admin Panel
                  </Link>
                )}
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  <button
                    className="sidebar-item"
                    onClick={() => { logout(); setShowUserMenu(false); navigate("/"); }}
                    style={{ width: "100%", color: "var(--error)" }}
                  >
                    <span className="icon">↩</span> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: "8px" }}>
            <Link to="/login" className="btn btn-ghost" style={{ fontSize: "var(--font-size-sm)" }}>
              Log in
            </Link>
            <Link to="/register" className="btn btn-primary" style={{ fontSize: "var(--font-size-sm)" }}>
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
