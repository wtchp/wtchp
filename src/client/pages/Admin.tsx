import { useEffect, useState } from "react";
import { apiFetch } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";

export function AdminPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"dashboard" | "videos" | "categories" | "add-video" | "models">("dashboard");
  const [stats, setStats] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Add video form
  const [videoForm, setVideoForm] = useState({
    title: "", description: "", video_url: "", thumbnail_url: "",
    duration: 0, resolution: "720p", tags: "", categories: [] as number[], models: [] as number[],
  });
  const [formMsg, setFormMsg] = useState("");

  // Add category form
  const [catForm, setCatForm] = useState({ name: "", description: "" });

  // Add model form
  const [modelForm, setModelForm] = useState({ name: "", bio: "", avatar_url: "" });

  // File upload state
  const [uploadMode, setUploadMode] = useState(true);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, v, c, m] = await Promise.all([
        apiFetch("/admin/stats"),
        apiFetch("/admin/videos?per_page=50"),
        apiFetch("/categories"),
        apiFetch("/admin/models"),
      ]);
      if (s.success) setStats(s.data);
      if (v.success) setVideos(v.data);
      if (c.success) setCategories(c.data);
      if (m.success) setModels(m.data);
    } catch {}
    setLoading(false);
  };

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    try {
      const res = await apiFetch("/admin/videos", {
        method: "POST",
        body: {
          ...videoForm,
          tags: videoForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
          duration: Number(videoForm.duration),
        },
      });
      if (res.success) {
        setFormMsg(`Video created: ${res.data.slug}`);
        setVideoForm({
          title: "", description: "", video_url: "", thumbnail_url: "",
          duration: 0, resolution: "720p", tags: "", categories: [], models: [],
        });
        loadData();
      } else {
        setFormMsg(`Error: ${res.error}`);
      }
    } catch (err: any) {
      setFormMsg(`Error: ${err.message}`);
    }
  };

  const handleUploadVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setFormMsg("Error: Please select a video file");
      return;
    }
    setFormMsg("");
    setUploading(true);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      if (thumbFile) formData.append("thumbnail", thumbFile);
      formData.append("title", videoForm.title);
      formData.append("description", videoForm.description);
      formData.append("duration", String(videoForm.duration));
      formData.append("resolution", videoForm.resolution);
      formData.append("tags", JSON.stringify(videoForm.tags.split(",").map(t => t.trim()).filter(Boolean)));

      setUploadProgress(30);

      const token = localStorage.getItem("token");
      const response = await fetch("/api/admin/upload/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      setUploadProgress(90);
      const res: any = await response.json();

      if (res.success) {
        setFormMsg(`✅ Video uploaded: ${res.data.slug} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`);
        setVideoForm({
          title: "", description: "", video_url: "", thumbnail_url: "",
          duration: 0, resolution: "720p", tags: "", categories: [], models: [],
        });
        setVideoFile(null);
        setThumbFile(null);
        setUploadProgress(100);
        loadData();
      } else {
        setFormMsg(`Error: ${res.error}`);
      }
    } catch (err: any) {
      setFormMsg(`Error: ${err.message}`);
    }
    setUploading(false);
    setTimeout(() => setUploadProgress(0), 2000);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/admin/categories", {
        method: "POST",
        body: catForm,
      });
      if (res.success) {
        setCatForm({ name: "", description: "" });
        loadData();
      }
    } catch {}
  };

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/admin/models", {
        method: "POST",
        body: modelForm,
      });
      if (res.success) {
        setModelForm({ name: "", bio: "", avatar_url: "" });
        loadData();
      }
    } catch {}
  };

  const handleDeleteVideo = async (id: number) => {
    if (!confirm("Delete this video?")) return;
    await apiFetch(`/admin/videos/${id}`, { method: "DELETE" });
    loadData();
  };

  const handleDeleteModel = async (id: number) => {
    if (!confirm("Delete this model?")) return;
    await apiFetch(`/admin/models/${id}`, { method: "DELETE" });
    loadData();
  };

  const [ingesting, setIngesting] = useState<Record<number, string>>({});

  const handleIngest = async (id: number) => {
    setIngesting((prev) => ({ ...prev, [id]: "Downloading..." }));
    try {
      const res = await apiFetch(`/admin/ingest/${id}`, { method: "POST" });
      if (res.success) {
        const d = res.data;
        let msg = "";
        if (d.thumbnail?.status === "ok") msg += "✅ Thumbnail saved. ";
        if (d.video?.status === "ok") msg += `✅ Video saved (${d.video.type}${d.video.segments ? `, ${d.video.segments} segments` : ""}). `;
        if (d.video?.errors?.length) msg += `⚠ ${d.video.errors.length} segment errors. `;
        if (d.thumbnail?.status === "error") msg += `❌ Thumb: ${d.thumbnail.error}. `;
        if (d.video?.status === "error") msg += `❌ Video: ${d.video.error}. `;
        setIngesting((prev) => ({ ...prev, [id]: msg || "Done" }));
        loadData();
      } else {
        setIngesting((prev) => ({ ...prev, [id]: `Error: ${res.error}` }));
      }
    } catch (err: any) {
      setIngesting((prev) => ({ ...prev, [id]: `Error: ${err.message}` }));
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="icon">🔒</div>
          <h3>Admin access required</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container page-enter">
      <div className="section-title" style={{ marginBottom: "var(--space-lg)" }}>
        ⚙ Admin <span className="accent">Panel</span>
      </div>

      <div className="admin-layout">
        <div className="admin-sidebar">
          {[
            { key: "dashboard", label: "📊 Dashboard" },
            { key: "videos", label: "📹 Videos" },
            { key: "add-video", label: "➕ Add Video" },
            { key: "categories", label: "📁 Categories" },
            { key: "models", label: "👤 Models" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`sidebar-item ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key as any)}
              style={{ width: "100%" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="admin-content">
          {/* Dashboard */}
          {activeTab === "dashboard" && stats && (
            <div>
              <div className="stat-cards">
                <div className="stat-card">
                  <div className="stat-value">{stats.videos}</div>
                  <div className="stat-label">Total Videos</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.users}</div>
                  <div className="stat-label">Users</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.categories}</div>
                  <div className="stat-label">Categories</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.models || 0}</div>
                  <div className="stat-label">Models</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{(stats.total_views || 0).toLocaleString()}</div>
                  <div className="stat-label">Total Views</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.today_views || 0}</div>
                  <div className="stat-label">Views Today</div>
                </div>
              </div>
            </div>
          )}

          {/* Videos List */}
          {activeTab === "videos" && (
            <div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Storage</th>
                    <th>Status</th>
                    <th>Views</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => {
                    const isLocal = v.video_url?.startsWith("/api/stream");
                    const thumbLocal = v.thumbnail_url?.startsWith("/api/stream");
                    return (
                    <tr key={v.id}>
                      <td>{v.id}</td>
                      <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.title}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
                          <span style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            borderRadius: "var(--radius-full)",
                            background: isLocal ? "rgba(46,213,115,0.15)" : "rgba(255,165,2,0.15)",
                            color: isLocal ? "var(--success)" : "var(--warning)",
                          }}>
                            {isLocal ? "📦 R2" : "🔗 Remote"}
                          </span>
                          <span style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            borderRadius: "var(--radius-full)",
                            background: thumbLocal ? "rgba(46,213,115,0.15)" : v.thumbnail_url ? "rgba(255,165,2,0.15)" : "rgba(100,100,100,0.15)",
                            color: thumbLocal ? "var(--success)" : v.thumbnail_url ? "var(--warning)" : "var(--text-tertiary)",
                          }}>
                            {thumbLocal ? "🖼 R2" : v.thumbnail_url ? "🖼 Remote" : "🖼 None"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: "var(--font-size-xs)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          background: v.status === "active" ? "rgba(46,213,115,0.15)" : "rgba(255,71,87,0.15)",
                          color: v.status === "active" ? "var(--success)" : "var(--error)",
                        }}>
                          {v.status}
                        </span>
                      </td>
                      <td>{(v.view_count || 0).toLocaleString()}</td>
                      <td>{new Date(v.created_at).toLocaleDateString()}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
                          {!isLocal && (
                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: "10px", padding: "2px 8px" }}
                              onClick={() => handleIngest(v.id)}
                              disabled={ingesting[v.id] === "Downloading..."}
                            >
                              {ingesting[v.id] === "Downloading..." ? "⏳" : "💾"} Ingest
                            </button>
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ color: "var(--error)", fontSize: "10px" }}
                            onClick={() => handleDeleteVideo(v.id)}
                          >
                            🗑 Delete
                          </button>
                        </div>
                        {ingesting[v.id] && ingesting[v.id] !== "Downloading..." && (
                          <div style={{ fontSize: "10px", marginTop: 4, maxWidth: 200, wordBreak: "break-word", color: "var(--text-secondary)" }}>
                            {ingesting[v.id]}
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {videos.length === 0 && !loading && (
                <div className="empty-state"><p>No videos yet</p></div>
              )}
            </div>
          )}

          {/* Add Video */}
          {activeTab === "add-video" && (
            <div style={{ maxWidth: 600 }}>
              <h3 style={{ marginBottom: "var(--space-md)" }}>Add New Video</h3>

              {/* Mode toggle */}
              <div style={{ display: "flex", gap: 8, marginBottom: "var(--space-lg)" }}>
                <button
                  type="button"
                  className={`btn ${!videoForm.video_url && !uploadMode ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setUploadMode(true)}
                  style={{ flex: 1 }}
                >
                  📁 File Upload
                </button>
                <button
                  type="button"
                  className={`btn ${!uploadMode ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setUploadMode(false)}
                  style={{ flex: 1 }}
                >
                  🔗 URL Mode
                </button>
              </div>

              <form onSubmit={uploadMode ? handleUploadVideo : handleAddVideo}>
                <div className="form-group">
                  <label>Title *</label>
                  <input
                    value={videoForm.title}
                    onChange={(e) => setVideoForm({ ...videoForm, title: e.target.value })}
                    placeholder="Video title"
                    required
                  />
                </div>

                {uploadMode ? (
                  <>
                    <div className="form-group">
                      <label>Video File (MP4, WebM) *</label>
                      <input
                        type="file"
                        accept="video/*,.mp4,.webm,.vid"
                        onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                        style={{
                          padding: "var(--space-md)", background: "var(--bg-primary)",
                          border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                          width: "100%", color: "var(--text-primary)",
                        }}
                        required
                      />
                      {videoFile && (
                        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-secondary)", marginTop: 4 }}>
                          {videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      )}
                    </div>
                    <div className="form-group">
                      <label>Thumbnail Image (optional)</label>
                      <input
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => setThumbFile(e.target.files?.[0] || null)}
                        style={{
                          padding: "var(--space-md)", background: "var(--bg-primary)",
                          border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                          width: "100%", color: "var(--text-primary)",
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="form-group">
                      <label>Video URL (HLS manifest or MP4) *</label>
                      <input
                        value={videoForm.video_url}
                        onChange={(e) => setVideoForm({ ...videoForm, video_url: e.target.value })}
                        placeholder="https://... or /api/stream/slug/master.m3u8"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Thumbnail URL</label>
                      <input
                        value={videoForm.thumbnail_url}
                        onChange={(e) => setVideoForm({ ...videoForm, thumbnail_url: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
                  <div className="form-group">
                    <label>Duration (seconds)</label>
                    <input
                      type="number"
                      value={videoForm.duration}
                      onChange={(e) => setVideoForm({ ...videoForm, duration: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Resolution</label>
                    <input
                      value={videoForm.resolution}
                      onChange={(e) => setVideoForm({ ...videoForm, resolution: e.target.value })}
                      placeholder="720p"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    style={{
                      width: "100%", minHeight: 80, padding: "var(--space-md)",
                      background: "var(--bg-primary)", border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)", color: "var(--text-primary)", resize: "vertical",
                    }}
                    value={videoForm.description}
                    onChange={(e) => setVideoForm({ ...videoForm, description: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Tags (comma separated)</label>
                  <input
                    value={videoForm.tags}
                    onChange={(e) => setVideoForm({ ...videoForm, tags: e.target.value })}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>
                <div className="form-group">
                  <label>Categories</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {categories.map((cat) => (
                      <label key={cat.id} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 12px", background: "var(--bg-primary)",
                        borderRadius: "var(--radius-full)", fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                        border: videoForm.categories.includes(cat.id)
                          ? "1px solid var(--accent)" : "1px solid var(--border)",
                      }}>
                        <input
                          type="checkbox"
                          checked={videoForm.categories.includes(cat.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setVideoForm({ ...videoForm, categories: [...videoForm.categories, cat.id] });
                            } else {
                              setVideoForm({ ...videoForm, categories: videoForm.categories.filter((c) => c !== cat.id) });
                            }
                          }}
                          style={{ display: "none" }}
                        />
                        {cat.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Models</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {models.map((model) => (
                      <label key={model.id} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 12px", background: "var(--bg-primary)",
                        borderRadius: "var(--radius-full)", fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                        border: videoForm.models.includes(model.id)
                          ? "1px solid var(--accent)" : "1px solid var(--border)",
                      }}>
                        <input
                          type="checkbox"
                          checked={videoForm.models.includes(model.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setVideoForm({ ...videoForm, models: [...videoForm.models, model.id] });
                            } else {
                              setVideoForm({ ...videoForm, models: videoForm.models.filter((m) => m !== model.id) });
                            }
                          }}
                          style={{ display: "none" }}
                        />
                        {model.name}
                      </label>
                    ))}
                    {models.length === 0 && (
                      <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
                        No models yet — create them in the Models tab first
                      </span>
                    )}
                  </div>
                </div>
                {formMsg && (
                  <div style={{
                    padding: "var(--space-sm) var(--space-md)",
                    background: formMsg.startsWith("Error") ? "rgba(255,71,87,0.1)" : "rgba(46,213,115,0.1)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--font-size-sm)",
                    marginBottom: "var(--space-md)",
                    color: formMsg.startsWith("Error") ? "var(--error)" : "var(--success)",
                    wordBreak: "break-word",
                  }}>
                    {formMsg}
                  </div>
                )}
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div style={{ marginBottom: "var(--space-md)" }}>
                    <div style={{
                      height: 6, background: "var(--bg-surface-active)",
                      borderRadius: "var(--radius-full)", overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", width: `${uploadProgress}%`,
                        background: "var(--accent)", transition: "width 0.3s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" }}>
                      Uploading... {uploadProgress}%
                    </span>
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-lg" disabled={uploading}>
                  {uploading ? "Uploading..." : uploadMode ? "📁 Upload & Create" : "🔗 Add Video"}
                </button>
              </form>
            </div>
          )}

          {/* Categories */}
          {activeTab === "categories" && (
            <div>
              <form onSubmit={handleAddCategory} style={{
                display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-lg)",
                alignItems: "flex-end",
              }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Category Name</label>
                  <input
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    placeholder="New category name"
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label>Description</label>
                  <input
                    value={catForm.description}
                    onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
                <button type="submit" className="btn btn-primary">Add</button>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Videos</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.id}>
                      <td>{cat.id}</td>
                      <td>{cat.name}</td>
                      <td style={{ color: "var(--text-tertiary)" }}>{cat.slug}</td>
                      <td>{cat.video_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {categories.length === 0 && (
                <div className="empty-state"><p>No categories yet</p></div>
              )}
            </div>
          )}

          {/* Models */}
          {activeTab === "models" && (
            <div>
              <h3 style={{ marginBottom: "var(--space-md)" }}>Manage Models</h3>
              <form onSubmit={handleAddModel} style={{
                display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-lg)",
                alignItems: "flex-end", flexWrap: "wrap",
              }}>
                <div className="form-group" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
                  <label>Name *</label>
                  <input
                    value={modelForm.name}
                    onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                    placeholder="Model name"
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
                  <label>Bio</label>
                  <input
                    value={modelForm.bio}
                    onChange={(e) => setModelForm({ ...modelForm, bio: e.target.value })}
                    placeholder="Short bio (optional)"
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
                  <label>Avatar URL</label>
                  <input
                    value={modelForm.avatar_url}
                    onChange={(e) => setModelForm({ ...modelForm, avatar_url: e.target.value })}
                    placeholder="https://... (optional)"
                  />
                </div>
                <button type="submit" className="btn btn-primary">Add Model</button>
              </form>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Avatar</th>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Videos</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td>{model.id}</td>
                      <td>
                        {model.avatar_url ? (
                          <img
                            src={model.avatar_url}
                            alt={model.name}
                            style={{
                              width: 32, height: 32, borderRadius: "var(--radius-full)",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 32, height: 32, borderRadius: "var(--radius-full)",
                            background: "var(--gradient-accent)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "var(--font-size-sm)", fontWeight: 700,
                          }}>
                            {model.name[0]?.toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>{model.name}</td>
                      <td style={{ color: "var(--text-tertiary)" }}>{model.slug}</td>
                      <td>{model.video_count || 0}</td>
                      <td>
                        <button
                          className="btn btn-ghost"
                          style={{ color: "var(--error)", fontSize: "var(--font-size-xs)" }}
                          onClick={() => handleDeleteModel(model.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {models.length === 0 && (
                <div className="empty-state">
                  <div className="icon">👤</div>
                  <h3>No models yet</h3>
                  <p>Add models above. They can then be assigned to videos.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
