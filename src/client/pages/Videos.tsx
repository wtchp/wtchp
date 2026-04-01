import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function VideosPage() {
  const [searchParams] = useSearchParams();
  const sort = searchParams.get("sort") || "newest";
  const [videos, setVideos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentSort, setCurrentSort] = useState(sort);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCurrentSort(sort);
    setPage(1);
  }, [sort]);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/videos?page=${page}&sort=${currentSort}&per_page=24`).then((res) => {
      if (res.success) {
        setVideos(res.data);
        setTotal(res.total);
        setTotalPages(res.total_pages);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [page, currentSort]);

  const sortLabels: Record<string, string> = {
    newest: "Newest",
    popular: "Most Viewed",
    most_liked: "Most Liked",
    trending: "Trending",
  };

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-sm)" }}>
        All <span className="accent">Videos</span>
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)", fontWeight: 400, marginLeft: 8 }}>
          {total} total
        </span>
      </div>

      <div className="sort-tabs">
        {Object.entries(sortLabels).map(([key, label]) => (
          <button
            key={key}
            className={`sort-tab ${currentSort === key ? "active" : ""}`}
            onClick={() => { setCurrentSort(key); setPage(1); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="video-grid">
        {loading
          ? Array.from({ length: 12 }).map((_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((video) => <VideoCard key={video.id} video={video} />)
        }
      </div>

      {!loading && videos.length === 0 && (
        <div className="empty-state">
          <div className="icon">📹</div>
          <h3>No videos yet</h3>
          <p>Videos will appear here once content is added.</p>
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
              <button key={pageNum} className={page === pageNum ? "active" : ""} onClick={() => setPage(pageNum)}>
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
