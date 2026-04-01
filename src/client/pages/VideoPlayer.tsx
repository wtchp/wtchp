import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import Hls from "hls.js";
import { apiFetch } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { VideoCard } from "../components/VideoCard";

export function VideoPlayerPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [video, setVideo] = useState<any>(null);
  const [related, setRelated] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentPage, setCommentPage] = useState(1);
  const [commentTotal, setCommentTotal] = useState(0);
  const [reaction, setReaction] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);

  // Fetch video data
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);

    apiFetch(`/videos/${slug}`).then((res) => {
      if (res.success) {
        setVideo(res.data);
        setRelated(res.data.related || []);
        setReaction(res.data.user_reaction);
        setIsFavorited(res.data.is_favorited);
        setLikeCount(res.data.like_count);
        setDislikeCount(res.data.dislike_count);
      } else {
        setError(res.error);
      }
    }).catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Record view after 3 seconds
    const viewTimer = setTimeout(() => {
      apiFetch(`/videos/${slug}`).then((res) => {
        if (res.success && res.data.id) {
          apiFetch(`/videos/${res.data.id}/view`, { method: "POST" }).catch(() => {});
        }
      });
    }, 3000);

    return () => clearTimeout(viewTimer);
  }, [slug]);

  // Init HLS player
  useEffect(() => {
    if (!video || !videoRef.current) return;

    const videoUrl = video.video_url;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (videoUrl.endsWith(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });
        hls.loadSource(videoUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setError("Video playback error");
                break;
            }
          }
        });
        hlsRef.current = hls;
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        videoRef.current.src = videoUrl;
        videoRef.current.addEventListener("loadedmetadata", () => {
          videoRef.current?.play().catch(() => {});
        });
      }
    } else {
      // Direct MP4
      videoRef.current.src = videoUrl;
      videoRef.current.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [video]);

  // Fetch comments
  useEffect(() => {
    if (!video) return;
    apiFetch(`/stream/comments/${video.id}?page=${commentPage}`).then((res) => {
      if (res.success) {
        setComments(res.data);
        setCommentTotal(res.total);
      }
    }).catch(() => {});
  }, [video, commentPage]);

  // Save watch progress
  useEffect(() => {
    if (!video || !user || !videoRef.current) return;
    const interval = setInterval(() => {
      if (videoRef.current) {
        const progress = Math.floor(videoRef.current.currentTime);
        apiFetch(`/user/history/${video.id}`, {
          method: "POST",
          body: { progress },
        }).catch(() => {});
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [video, user]);

  const handleReaction = async (type: "like" | "dislike") => {
    if (!user) return;
    try {
      const res = await apiFetch(`/user/reactions/${video.id}`, {
        method: "POST",
        body: { reaction: type },
      });
      if (res.success) {
        const newReaction = res.data.reaction;
        // Update counts
        if (reaction === null && newReaction === "like") setLikeCount((c) => c + 1);
        else if (reaction === null && newReaction === "dislike") setDislikeCount((c) => c + 1);
        else if (reaction === "like" && newReaction === null) setLikeCount((c) => c - 1);
        else if (reaction === "dislike" && newReaction === null) setDislikeCount((c) => c - 1);
        else if (reaction === "like" && newReaction === "dislike") { setLikeCount((c) => c - 1); setDislikeCount((c) => c + 1); }
        else if (reaction === "dislike" && newReaction === "like") { setDislikeCount((c) => c - 1); setLikeCount((c) => c + 1); }
        setReaction(newReaction);
      }
    } catch {}
  };

  const handleFavorite = async () => {
    if (!user) return;
    try {
      const res = await apiFetch(`/user/favorites/${video.id}`, { method: "POST" });
      if (res.success) setIsFavorited(res.data.favorited);
    } catch {}
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !user) return;
    try {
      const res = await apiFetch(`/user/comments/${video.id}`, {
        method: "POST",
        body: { body: commentText.trim() },
      });
      if (res.success) {
        setComments((prev) => [res.data, ...prev]);
        setCommentText("");
        setCommentTotal((t) => t + 1);
      }
    } catch {}
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric"
  });

  if (loading) {
    return (
      <div className="page-container">
        <div className="player-wrapper skeleton" />
        <div className="skeleton skeleton-text" style={{ width: "60%", height: 24, marginTop: 16 }} />
        <div className="skeleton skeleton-text short" style={{ marginTop: 8 }} />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="icon">😞</div>
          <h3>Video not found</h3>
          <p>{error || "The video you're looking for doesn't exist."}</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 16 }}>Go Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-enter">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--space-lg)" }}>
        {/* Main column */}
        <div style={{ minWidth: 0 }}>
          {/* Player */}
          <div className="player-wrapper">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%" }}
              poster={video.thumbnail_url || undefined}
            />
          </div>

          {/* Video Info */}
          <div className="video-info">
            <h1 className="video-title">{video.title}</h1>
            <div className="video-stats">
              <span>{formatNumber(video.view_count)} views</span>
              <span>•</span>
              <span>{formatDate(video.created_at)}</span>
              {video.categories?.map((cat: any) => (
                <Link key={cat.slug} to={`/category/${cat.slug}`} className="tag" style={{ marginLeft: 4 }}>
                  {cat.name}
                </Link>
              ))}
            </div>

            <div className="video-actions">
              <button
                className={`btn btn-secondary ${reaction === "like" ? "active" : ""}`}
                onClick={() => handleReaction("like")}
              >
                👍 {formatNumber(likeCount)}
              </button>
              <button
                className={`btn btn-secondary ${reaction === "dislike" ? "active" : ""}`}
                onClick={() => handleReaction("dislike")}
              >
                👎 {formatNumber(dislikeCount)}
              </button>
              <button
                className={`btn btn-secondary ${isFavorited ? "active" : ""}`}
                onClick={handleFavorite}
              >
                {isFavorited ? "♥" : "♡"} Favorite
              </button>
            </div>

            {video.description && (
              <div style={{
                marginTop: "var(--space-md)",
                padding: "var(--space-md)",
                background: "var(--bg-surface)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--font-size-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}>
                {video.description}
              </div>
            )}

            {/* Models */}
            {video.models?.length > 0 && (
              <div style={{ marginTop: "var(--space-md)" }}>
                <div style={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-sm)",
                }}>
                  Models
                </div>
                <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                  {video.models.map((model: any) => (
                    <Link
                      key={model.id}
                      to={`/model/${model.slug}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-sm)",
                        padding: "6px 14px",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-full)",
                        transition: "all var(--transition-fast)",
                        fontSize: "var(--font-size-sm)",
                        fontWeight: 500,
                      }}
                      className="model-chip"
                    >
                      {model.avatar_url ? (
                        <img
                          src={model.avatar_url}
                          alt={model.name}
                          style={{
                            width: 24, height: 24, borderRadius: "50%", objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%",
                          background: "var(--gradient-accent)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "10px", fontWeight: 700,
                        }}>
                          {model.name[0]?.toUpperCase()}
                        </div>
                      )}
                      {model.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {video.tags?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "var(--space-md)" }}>
                {video.tags.map((tag: string) => (
                  <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className="tag">
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="comments-section">
            <div className="section-title">
              💬 {commentTotal} Comments
            </div>

            {user && (
              <form className="comment-form" onSubmit={handleComment}>
                <div style={{ flex: 1 }}>
                  <textarea
                    placeholder="Add a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    maxLength={2000}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={!commentText.trim()}>
                      Comment
                    </button>
                  </div>
                </div>
              </form>
            )}

            {comments.map((comment) => (
              <div key={comment.id} className="comment-item">
                <div className="comment-avatar">
                  {(comment.display_name || comment.username)?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="comment-body">
                  <div className="comment-header">
                    <span className="comment-username">{comment.display_name || comment.username}</span>
                    <span className="comment-time">{formatDate(comment.created_at)}</span>
                  </div>
                  <p className="comment-text">{comment.body}</p>
                  {/* Replies */}
                  {comment.replies?.map((reply: any) => (
                    <div key={reply.id} className="comment-item" style={{ borderBottom: "none", paddingBottom: 0 }}>
                      <div className="comment-avatar" style={{ width: 28, height: 28, fontSize: "10px" }}>
                        {(reply.display_name || reply.username)?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="comment-body">
                        <div className="comment-header">
                          <span className="comment-username">{reply.display_name || reply.username}</span>
                          <span className="comment-time">{formatDate(reply.created_at)}</span>
                        </div>
                        <p className="comment-text">{reply.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {comments.length === 0 && (
              <div className="empty-state" style={{ padding: "var(--space-xl)" }}>
                <p>No comments yet. Be the first to comment!</p>
              </div>
            )}
          </div>
        </div>

        {/* Related Videos sidebar */}
        <div className="hide-mobile">
          <div className="section-title" style={{ fontSize: "var(--font-size-base)" }}>
            Related Videos
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {related.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
          {related.length === 0 && (
            <div className="empty-state" style={{ padding: "var(--space-lg)" }}>
              <p style={{ fontSize: "var(--font-size-sm)" }}>No related videos</p>
            </div>
          )}
        </div>
      </div>

      {/* Related videos for mobile - horizontal scroll */}
      <div className="show-mobile" style={{ marginTop: "var(--space-xl)" }}>
        <div className="section-title" style={{ fontSize: "var(--font-size-base)" }}>
          Related Videos
        </div>
        <div className="video-grid">
          {related.slice(0, 6).map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      </div>
    </div>
  );
}
