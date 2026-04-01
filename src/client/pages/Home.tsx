import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function HomePage() {
  const [trending, setTrending] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch("/videos/trending?limit=12"),
      apiFetch("/videos/recent?limit=12"),
      apiFetch("/categories"),
    ]).then(([t, r, c]) => {
      if (t.success) setTrending(t.data);
      if (r.success) setRecent(r.data);
      if (c.success) setCategories(c.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-container page-enter">
      {/* Category Pills */}
      {categories.length > 0 && (
        <div className="category-pills" style={{ marginBottom: "var(--space-xl)" }}>
          <Link to="/videos" className="category-pill active">All</Link>
          {categories.map((cat) => (
            <Link key={cat.slug} to={`/category/${cat.slug}`} className="category-pill">
              {cat.name}
            </Link>
          ))}
        </div>
      )}

      {/* Trending */}
      <section style={{ marginBottom: "var(--space-2xl)" }}>
        <div className="section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span>Trending <span className="accent">Now</span></span>
          <Link to="/videos?sort=trending" className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: "var(--font-size-xs)" }}>
            See all →
          </Link>
        </div>
        <div className="video-grid">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <VideoCardSkeleton key={i} />)
            : trending.map((video) => <VideoCard key={video.id} video={video} />)
          }
        </div>
        {!loading && trending.length === 0 && (
          <div className="empty-state">
            <div className="icon">📹</div>
            <h3>No videos yet</h3>
            <p>Videos will appear here once they are added.</p>
          </div>
        )}
      </section>

      {/* Recently Added */}
      <section style={{ marginBottom: "var(--space-2xl)" }}>
        <div className="section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Recently <span className="accent">Added</span></span>
          <Link to="/videos?sort=newest" className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: "var(--font-size-xs)" }}>
            See all →
          </Link>
        </div>
        <div className="video-grid">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <VideoCardSkeleton key={i} />)
            : recent.map((video) => <VideoCard key={video.id} video={video} />)
          }
        </div>
      </section>

      {/* Categories Grid */}
      {categories.length > 0 && (
        <section>
          <div className="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Browse <span className="accent">Categories</span></span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "var(--space-md)"
          }}>
            {categories.map((cat) => (
              <Link
                key={cat.slug}
                to={`/category/${cat.slug}`}
                style={{
                  display: "block",
                  padding: "var(--space-lg)",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  transition: "all var(--transition-fast)",
                  textAlign: "center",
                }}
                className="video-card"
              >
                <div style={{
                  fontSize: "var(--font-size-md)",
                  fontWeight: 600,
                  marginBottom: "var(--space-xs)",
                }}>
                  {cat.name}
                </div>
                <div style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-tertiary)",
                }}>
                  {cat.video_count} videos
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
