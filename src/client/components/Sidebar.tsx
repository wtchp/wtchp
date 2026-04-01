import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [categories, setCategories] = useState<any[]>([]);
  const location = useLocation();

  useEffect(() => {
    apiFetch("/categories").then((res) => {
      if (res.success) setCategories(res.data);
    }).catch(() => {});
  }, []);

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 899,
            display: "none",
          }}
          className="show-mobile"
          onClick={onClose}
        />
      )}

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-section">
          <Link
            to="/"
            className={`sidebar-item ${isActive("/") ? "active" : ""}`}
            onClick={onClose}
          >
            <span className="icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </span>
            Home
          </Link>
          <Link
            to="/videos?sort=trending"
            className={`sidebar-item ${location.search.includes("trending") ? "active" : ""}`}
            onClick={onClose}
          >
            <span className="icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            Trending
          </Link>
          <Link
            to="/videos?sort=newest"
            className={`sidebar-item ${location.search.includes("newest") ? "active" : ""}`}
            onClick={onClose}
          >
            <span className="icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            New
          </Link>
          <Link
            to="/videos?sort=popular"
            className={`sidebar-item ${location.search.includes("popular") ? "active" : ""}`}
            onClick={onClose}
          >
            <span className="icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </span>
            Popular
          </Link>
        </div>

        {categories.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Categories</div>
            {categories.map((cat) => (
              <Link
                key={cat.slug}
                to={`/category/${cat.slug}`}
                className={`sidebar-item ${location.pathname === `/category/${cat.slug}` ? "active" : ""}`}
                onClick={onClose}
              >
                <span className="icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                {cat.name}
                {cat.video_count > 0 && (
                  <span className="count">{cat.video_count}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
