import { useEffect, useState } from "react";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function FavoritesPage() {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/user/favorites?page=${page}`).then((res) => {
      if (res.success) {
        setVideos(res.data);
        setTotalPages(res.total_pages);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [page]);

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-lg)" }}>
        ♥ My <span className="accent">Favorites</span>
      </div>

      <div className="video-grid">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((video) => <VideoCard key={video.id} video={video} />)
        }
      </div>

      {!loading && videos.length === 0 && (
        <div className="empty-state">
          <div className="icon">♡</div>
          <h3>No favorites yet</h3>
          <p>Videos you favorite will appear here.</p>
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

export function HistoryPage() {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch("/user/history").then((res) => {
      if (res.success) setVideos(res.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-lg)" }}>
        ⏱ Watch <span className="accent">History</span>
      </div>

      <div className="video-grid">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((video) => <VideoCard key={video.id} video={video} />)
        }
      </div>

      {!loading && videos.length === 0 && (
        <div className="empty-state">
          <div className="icon">⏱</div>
          <h3>No watch history</h3>
          <p>Videos you watch will appear here.</p>
        </div>
      )}
    </div>
  );
}
