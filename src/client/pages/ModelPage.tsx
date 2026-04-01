import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function ModelPage() {
  const { slug } = useParams<{ slug: string }>();
  const [model, setModel] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    apiFetch(`/models/${slug}?page=${page}`).then((res) => {
      if (res.success) {
        setModel(res.data.model);
        setVideos(res.data.videos);
        setTotal(res.data.total);
        setTotalPages(res.data.total_pages);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [slug, page]);

  if (!loading && !model) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="icon">👤</div>
          <h3>Model not found</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-enter">
      {/* Model Profile Header */}
      {model && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-lg)",
          marginBottom: "var(--space-xl)",
          padding: "var(--space-lg)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
        }}>
          {model.avatar_url ? (
            <img
              src={model.avatar_url}
              alt={model.name}
              style={{
                width: 80, height: 80, borderRadius: "50%", objectFit: "cover",
                border: "3px solid var(--accent)",
              }}
            />
          ) : (
            <div style={{
              width: 80, height: 80, borderRadius: "50%",
              background: "var(--gradient-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "var(--font-size-2xl)", fontWeight: 700,
              flexShrink: 0,
            }}>
              {model.name[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, marginBottom: "var(--space-xs)" }}>
              {model.name}
            </h1>
            {model.bio && (
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-sm)", marginBottom: "var(--space-xs)" }}>
                {model.bio}
              </p>
            )}
            <span style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--text-tertiary)",
            }}>
              {total} videos
            </span>
          </div>
        </div>
      )}

      <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>
        Videos
      </div>

      <div className="video-grid">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((video) => <VideoCard key={video.id} video={video} />)
        }
      </div>

      {!loading && videos.length === 0 && (
        <div className="empty-state">
          <div className="icon">📹</div>
          <h3>No videos yet</h3>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
