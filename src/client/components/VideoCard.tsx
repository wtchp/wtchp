import { Link, useNavigate } from "react-router-dom";

interface VideoCardProps {
  video: {
    id: number;
    slug: string;
    title: string;
    thumbnail_url: string | null;
    duration: number;
    view_count: number;
    like_count: number;
    resolution: string;
    created_at: string;
    categories?: { name: string; slug: string }[];
  };
}

export function VideoCard({ video }: VideoCardProps) {
  const navigate = useNavigate();

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatViews = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  return (
    <div className="video-card" onClick={() => navigate(`/video/${video.slug}`)}>
      <div className="thumbnail-container">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            loading="lazy"
          />
        ) : (
          <div style={{
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-tertiary)",
            fontSize: "2rem"
          }}>
            ▶
          </div>
        )}
        <span className="duration-badge">{formatDuration(video.duration)}</span>
        {video.resolution && ["1080p", "4K"].includes(video.resolution) && (
          <span className="quality-badge">{video.resolution}</span>
        )}
      </div>
      <div className="card-info">
        <h3 className="card-title">{video.title}</h3>
        <div className="card-meta">
          <span>{formatViews(video.view_count)} views</span>
          <span className="dot" />
          <span>{timeAgo(video.created_at)}</span>
        </div>
        {video.categories && video.categories.length > 0 && (
          <div className="card-tags">
            {video.categories.slice(0, 3).map((cat) => (
              <Link
                key={cat.slug}
                to={`/category/${cat.slug}`}
                className="tag"
                onClick={(e) => e.stopPropagation()}
              >
                {cat.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="video-card">
      <div className="skeleton skeleton-thumbnail" />
      <div className="card-info">
        <div className="skeleton skeleton-text" style={{ width: "85%" }} />
        <div className="skeleton skeleton-text short" />
      </div>
    </div>
  );
}
