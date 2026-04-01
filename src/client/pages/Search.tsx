import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [videos, setVideos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!query) return;
    setLoading(true);
    apiFetch(`/search?q=${encodeURIComponent(query)}&page=${page}`).then((res) => {
      if (res.success) {
        setVideos(res.data);
        setTotal(res.total);
        setTotalPages(res.total_pages);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [query, page]);

  if (!query) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="icon">🔍</div>
          <h3>Search for videos</h3>
          <p>Type something in the search bar to find videos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-lg)" }}>
        Search results for "<span className="accent">{query}</span>"
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)", fontWeight: 400, marginLeft: 8 }}>
          {total} results
        </span>
      </div>

      <div className="video-grid">
        {loading
          ? Array.from({ length: 12 }).map((_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((video) => <VideoCard key={video.id} video={video} />)
        }
      </div>

      {!loading && videos.length === 0 && (
        <div className="empty-state">
          <div className="icon">😔</div>
          <h3>No results found</h3>
          <p>Try different keywords or browse categories.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 16 }}>Browse All</Link>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
          {Array.from({ length: Math.min(7, totalPages) }).map((_, i) => {
            let pageNum: number;
            if (totalPages <= 7) pageNum = i + 1;
            else if (page <= 4) pageNum = i + 1;
            else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
            else pageNum = page - 3 + i;
            return (
              <button
                key={pageNum}
                className={page === pageNum ? "active" : ""}
                onClick={() => setPage(pageNum)}
              >
                {pageNum}
              </button>
            );
          })}
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
