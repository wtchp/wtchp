import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { VideoCard, VideoCardSkeleton } from "../components/VideoCard";

export function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(parseInt(searchParams.get("page") || "1"));
  const [totalPages, setTotalPages] = useState(0);
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    apiFetch(`/categories/${slug}?page=${page}&sort=${sort}`).then((res) => {
      if (res.success) {
        setCategory(res.data.category);
        setVideos(res.data.videos);
        setTotal(res.data.total);
        setTotalPages(res.data.total_pages);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [slug, page, sort]);

  const handleSort = (newSort: string) => {
    setSort(newSort);
    setPage(1);
  };

  if (!loading && !category) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="icon">📁</div>
          <h3>Category not found</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-sm)" }}>
        {category?.name || "Loading..."}
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)", fontWeight: 400, marginLeft: 8 }}>
          {total} videos
        </span>
      </div>

      {category?.description && (
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-sm)", marginBottom: "var(--space-md)" }}>
          {category.description}
        </p>
      )}

      <div className="sort-tabs">
        {[
          { key: "newest", label: "Newest" },
          { key: "popular", label: "Most Viewed" },
          { key: "most_liked", label: "Most Liked" },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`sort-tab ${sort === tab.key ? "active" : ""}`}
            onClick={() => handleSort(tab.key)}
          >
            {tab.label}
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
          <h3>No videos in this category</h3>
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
