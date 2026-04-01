import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "../middleware/auth";
import { ingestThumbnail, ingestMP4, ingestHLS, ingestDASH } from "../services/ingest";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const adminRoutes = new Hono<HonoEnv>();

// All admin routes require admin auth
adminRoutes.use("*", requireAdmin());

// GET /api/admin/stats — dashboard stats
adminRoutes.get("/stats", async (c) => {
  try {
    const videoCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM videos").first<{ count: number }>();
    const userCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
    const categoryCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM categories").first<{ count: number }>();
    const modelCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM models").first<{ count: number }>();
    const totalViews = await c.env.DB.prepare("SELECT SUM(view_count) as total FROM videos").first<{ total: number }>();
    const todayViews = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM view_logs WHERE viewed_at >= datetime('now', '-1 day')"
    ).first<{ count: number }>();

    return c.json({
      success: true,
      data: {
        videos: videoCount?.count || 0,
        users: userCount?.count || 0,
        categories: categoryCount?.count || 0,
        models: modelCount?.count || 0,
        total_views: totalViews?.total || 0,
        today_views: todayViews?.count || 0,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/videos — create video (auto-ingest to R2)
adminRoutes.post("/videos", async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, duration, thumbnail_url, video_url, preview_url,
            resolution, file_size, source, source_url, tags, categories, models, status } = body;

    if (!title || !video_url) {
      return c.json({ success: false, error: "Title and video_url are required" }, 400);
    }

    const slug = generateSlug(title);
    const ingestResults: any = { thumbnail: null, video: null };

    // Auto-ingest thumbnail to R2
    let finalThumbnail: string | null = null;
    if (thumbnail_url) {
      if (thumbnail_url.startsWith("http://") || thumbnail_url.startsWith("https://")) {
        try {
          const thumbPath = await ingestThumbnail(c.env.STORAGE, thumbnail_url, slug);
          finalThumbnail = `/api/stream/thumb/${thumbPath}`;
          ingestResults.thumbnail = { status: "ok", path: thumbPath };
        } catch (e: any) {
          ingestResults.thumbnail = { status: "error", error: e.message };
        }
      } else {
        finalThumbnail = thumbnail_url; // already local
      }
    }

    // Auto-ingest video to R2
    let finalVideoUrl = video_url;
    let finalFileSize = file_size || 0;
    const originalVideoUrl = video_url;

    if (video_url.startsWith("http://") || video_url.startsWith("https://")) {
      try {
        if (video_url.includes(".m3u8")) {
          // HLS stream — already our target format
          const hlsResult = await ingestHLS(c.env.STORAGE, video_url, slug);
          finalVideoUrl = `/api/stream/${slug}/master.m3u8`;
          ingestResults.video = {
            status: "ok", type: "hls",
            segments: hlsResult.segmentCount,
            errors: hlsResult.errors.length > 0 ? hlsResult.errors : undefined,
          };
        } else if (video_url.includes(".mpd")) {
          // DASH stream → convert to HLS
          const dashResult = await ingestDASH(c.env.STORAGE, video_url, slug);
          finalVideoUrl = `/api/stream/${slug}/master.m3u8`;
          ingestResults.video = {
            status: "ok", type: "dash→hls",
            segments: dashResult.segmentCount,
            errors: dashResult.errors.length > 0 ? dashResult.errors : undefined,
          };
        } else {
          // MP4 — store directly
          const mp4Result = await ingestMP4(c.env.STORAGE, video_url, slug);
          finalVideoUrl = `/api/stream/${slug}/video.mp4`;
          finalFileSize = mp4Result.size;
          ingestResults.video = { status: "ok", type: "mp4", size: mp4Result.size };
        }
      } catch (e: any) {
        // If ingest fails, return error — never store external URLs
        return c.json({
          success: false,
          error: `Video ingest failed: ${e.message}. Content must be stored locally.`,
          ingest: ingestResults,
        }, 500);
      }
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO videos (title, slug, description, duration, thumbnail_url, video_url, preview_url,
       resolution, file_size, source, source_url, tags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      title, slug, description || null, duration || 0,
      finalThumbnail, finalVideoUrl, preview_url || null,
      resolution || "720p", finalFileSize,
      source || null, originalVideoUrl,
      JSON.stringify(tags || []), status || "active"
    ).run();

    const videoId = result.meta.last_row_id;

    // Assign categories
    if (categories && categories.length > 0) {
      for (const catId of categories) {
        await c.env.DB.prepare(
          "INSERT OR IGNORE INTO video_categories (video_id, category_id) VALUES (?, ?)"
        ).bind(videoId, catId).run();
      }
      for (const catId of categories) {
        await c.env.DB.prepare(
          "UPDATE categories SET video_count = (SELECT COUNT(*) FROM video_categories WHERE category_id = ?) WHERE id = ?"
        ).bind(catId, catId).run();
      }
    }

    // Assign models
    if (models && models.length > 0) {
      for (const modelId of models) {
        await c.env.DB.prepare(
          "INSERT OR IGNORE INTO video_models (video_id, model_id) VALUES (?, ?)"
        ).bind(videoId, modelId).run();
      }
      for (const modelId of models) {
        await c.env.DB.prepare(
          "UPDATE models SET video_count = (SELECT COUNT(*) FROM video_models WHERE model_id = ?) WHERE id = ?"
        ).bind(modelId, modelId).run();
      }
    }

    return c.json({ success: true, data: { id: videoId, slug, ingest: ingestResults } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/videos/bulk — bulk create videos
adminRoutes.post("/videos/bulk", async (c) => {
  try {
    const { videos } = await c.req.json<{ videos: any[] }>();
    if (!videos || !Array.isArray(videos)) {
      return c.json({ success: false, error: "videos array is required" }, 400);
    }

    const created: number[] = [];
    const errors: string[] = [];

    for (const video of videos) {
      try {
        const slug = generateSlug(video.title);
        const result = await c.env.DB.prepare(
          `INSERT INTO videos (title, slug, description, duration, thumbnail_url, video_url, preview_url,
           resolution, file_size, source, source_url, tags, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          video.title, slug, video.description || null, video.duration || 0,
          video.thumbnail_url || null, video.video_url, video.preview_url || null,
          video.resolution || "720p", video.file_size || 0,
          video.source || null, video.source_url || null,
          JSON.stringify(video.tags || []), video.status || "active"
        ).run();

        const videoId = result.meta.last_row_id;
        created.push(videoId as number);

        if (video.categories) {
          for (const catId of video.categories) {
            await c.env.DB.prepare(
              "INSERT OR IGNORE INTO video_categories (video_id, category_id) VALUES (?, ?)"
            ).bind(videoId, catId).run();
          }
        }
      } catch (err: any) {
        errors.push(`${video.title}: ${err.message}`);
      }
    }

    return c.json({
      success: true,
      data: { created: created.length, errors: errors.length, error_details: errors },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PUT /api/admin/videos/:id — update video
adminRoutes.put("/videos/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();

    const fields: string[] = [];
    const values: any[] = [];

    const allowedFields = [
      "title", "description", "duration", "thumbnail_url", "video_url",
      "preview_url", "resolution", "file_size", "source", "source_url", "status",
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (body.tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(body.tags));
    }

    if (body.title) {
      fields.push("slug = ?");
      values.push(generateSlug(body.title));
    }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await c.env.DB.prepare(
      `UPDATE videos SET ${fields.join(", ")} WHERE id = ?`
    ).bind(...values).run();

    // Update categories if provided
    if (body.categories) {
      await c.env.DB.prepare("DELETE FROM video_categories WHERE video_id = ?").bind(id).run();
      for (const catId of body.categories) {
        await c.env.DB.prepare(
          "INSERT OR IGNORE INTO video_categories (video_id, category_id) VALUES (?, ?)"
        ).bind(id, catId).run();
      }
    }

    // Update models if provided
    if (body.models) {
      await c.env.DB.prepare("DELETE FROM video_models WHERE video_id = ?").bind(id).run();
      for (const modelId of body.models) {
        await c.env.DB.prepare(
          "INSERT OR IGNORE INTO video_models (video_id, model_id) VALUES (?, ?)"
        ).bind(id, modelId).run();
      }
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// DELETE /api/admin/videos/:id
adminRoutes.delete("/videos/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    await c.env.DB.prepare("UPDATE videos SET status = 'deleted' WHERE id = ?").bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/categories — create category
adminRoutes.post("/categories", async (c) => {
  try {
    const { name, description, thumbnail_url, sort_order } = await c.req.json();
    if (!name) {
      return c.json({ success: false, error: "Category name is required" }, 400);
    }

    const slug = generateSlug(name);
    const result = await c.env.DB.prepare(
      "INSERT INTO categories (name, slug, description, thumbnail_url, sort_order) VALUES (?, ?, ?, ?, ?)"
    ).bind(name, slug, description || null, thumbnail_url || null, sort_order || 0).run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, slug } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PUT /api/admin/categories/:id — update category
adminRoutes.put("/categories/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const { name, description, thumbnail_url, sort_order } = await c.req.json();

    await c.env.DB.prepare(
      "UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description), thumbnail_url = COALESCE(?, thumbnail_url), sort_order = COALESCE(?, sort_order) WHERE id = ?"
    ).bind(name || null, description || null, thumbnail_url || null, sort_order ?? null, id).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// DELETE /api/admin/categories/:id
adminRoutes.delete("/categories/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/upload — upload file to R2
adminRoutes.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    const path = formData.get("path") as string;

    if (!file || !path) {
      return c.json({ success: false, error: "File and path are required" }, 400);
    }

    const buffer = await file.arrayBuffer();
    await c.env.STORAGE.put(path, buffer, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000",
      },
    });

    const url = `${c.env.R2_PUBLIC_URL}/${path}`;
    return c.json({ success: true, data: { url, path, size: file.size } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/admin/videos — list all videos (including inactive)
adminRoutes.get("/videos", async (c) => {
  try {
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = 50;
    const offset = (page - 1) * perPage;
    const status = c.req.query("status");

    let where = "WHERE status != 'deleted'";
    const binds: any[] = [];
    if (status) {
      where += " AND status = ?";
      binds.push(status);
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM videos ${where}`
    ).bind(...binds).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM videos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, perPage, offset).all();

    return c.json({
      success: true,
      data: results,
      total: countResult?.total || 0,
      page,
      per_page: perPage,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ============================================
// MODEL MANAGEMENT
// ============================================

// GET /api/admin/models — list all models
adminRoutes.get("/models", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM models ORDER BY name ASC"
    ).all();
    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/models — create model
adminRoutes.post("/models", async (c) => {
  try {
    const { name, bio, avatar_url } = await c.req.json();
    if (!name) {
      return c.json({ success: false, error: "Model name is required" }, 400);
    }

    const slug = generateSlug(name);
    const result = await c.env.DB.prepare(
      "INSERT INTO models (name, slug, bio, avatar_url) VALUES (?, ?, ?, ?)"
    ).bind(name, slug, bio || null, avatar_url || null).run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, slug } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PUT /api/admin/models/:id — update model
adminRoutes.put("/models/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const { name, bio, avatar_url } = await c.req.json();

    let updates: string[] = [];
    let binds: any[] = [];
    if (name !== undefined) { updates.push("name = ?"); binds.push(name); updates.push("slug = ?"); binds.push(generateSlug(name)); }
    if (bio !== undefined) { updates.push("bio = ?"); binds.push(bio); }
    if (avatar_url !== undefined) { updates.push("avatar_url = ?"); binds.push(avatar_url); }

    if (updates.length === 0) {
      return c.json({ success: false, error: "Nothing to update" }, 400);
    }

    binds.push(id);
    await c.env.DB.prepare(
      `UPDATE models SET ${updates.join(", ")} WHERE id = ?`
    ).bind(...binds).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// DELETE /api/admin/models/:id — delete model
adminRoutes.delete("/models/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    await c.env.DB.prepare("DELETE FROM video_models WHERE model_id = ?").bind(id).run();
    await c.env.DB.prepare("DELETE FROM models WHERE id = ?").bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
// ============================================
// CONTENT INGEST
// ============================================

// POST /api/admin/ingest/:id — download remote video content to R2
adminRoutes.post("/ingest/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const video = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE id = ?"
    ).bind(id).first<any>();

    if (!video) {
      return c.json({ success: false, error: "Video not found" }, 404);
    }

    const videoUrl = video.video_url;
    const slug = video.slug;
    const results: any = { thumbnail: null, video: null };

    // Ingest thumbnail if external
    if (video.thumbnail_url && (video.thumbnail_url.startsWith("http://") || video.thumbnail_url.startsWith("https://"))) {
      try {
        const thumbPath = await ingestThumbnail(c.env.STORAGE, video.thumbnail_url, slug);
        const localThumbUrl = `/api/stream/thumb/${thumbPath}`;
        await c.env.DB.prepare(
          "UPDATE videos SET thumbnail_url = ? WHERE id = ?"
        ).bind(localThumbUrl, id).run();
        results.thumbnail = { status: "ok", path: thumbPath };
      } catch (e: any) {
        results.thumbnail = { status: "error", error: e.message };
      }
    } else {
      results.thumbnail = { status: "skipped", reason: "already local or empty" };
    }

    // Ingest video
    if (videoUrl.startsWith("http://") || videoUrl.startsWith("https://")) {
      try {
        if (videoUrl.includes(".m3u8")) {
          // HLS stream
          const hlsResult = await ingestHLS(c.env.STORAGE, videoUrl, slug);
          const localVideoUrl = `/api/stream/${slug}/master.m3u8`;
          await c.env.DB.prepare(
            "UPDATE videos SET video_url = ?, source_url = ? WHERE id = ?"
          ).bind(localVideoUrl, videoUrl, id).run();
          results.video = {
            status: "ok",
            type: "hls",
            path: hlsResult.path,
            segments: hlsResult.segmentCount,
            errors: hlsResult.errors,
          };
        } else {
          // MP4
          const mp4Result = await ingestMP4(c.env.STORAGE, videoUrl, slug);
          const localVideoUrl = `/api/stream/${slug}/video.mp4`;
          await c.env.DB.prepare(
            "UPDATE videos SET video_url = ?, source_url = ?, file_size = ? WHERE id = ?"
          ).bind(localVideoUrl, videoUrl, mp4Result.size, id).run();
          results.video = {
            status: "ok",
            type: "mp4",
            path: mp4Result.path,
            size: mp4Result.size,
          };
        }
      } catch (e: any) {
        results.video = { status: "error", error: e.message };
      }
    } else {
      results.video = { status: "skipped", reason: "already local" };
    }

    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/ingest-thumbnail/:id — re-download just the thumbnail
adminRoutes.post("/ingest-thumbnail/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const { url } = await c.req.json<{ url: string }>();

    const video = await c.env.DB.prepare(
      "SELECT slug FROM videos WHERE id = ?"
    ).bind(id).first<any>();
    if (!video) return c.json({ success: false, error: "Video not found" }, 404);

    const thumbUrl = url || "";
    if (!thumbUrl.startsWith("http")) {
      return c.json({ success: false, error: "Valid URL required" }, 400);
    }

    const thumbPath = await ingestThumbnail(c.env.STORAGE, thumbUrl, video.slug);
    const localThumbUrl = `/api/stream/thumb/${thumbPath}`;
    await c.env.DB.prepare(
      "UPDATE videos SET thumbnail_url = ? WHERE id = ?"
    ).bind(localThumbUrl, id).run();

    return c.json({ success: true, data: { path: thumbPath, url: localThumbUrl } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/upload/video/:id — direct file upload (browser → R2)
adminRoutes.post("/upload/video/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const video = await c.env.DB.prepare("SELECT slug FROM videos WHERE id = ?").bind(id).first<any>();
    if (!video) return c.json({ success: false, error: "Video not found" }, 404);

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return c.json({ success: false, error: "No file uploaded" }, 400);

    const isHLS = file.name.endsWith(".m3u8");
    const ext = file.name.split(".").pop() || "mp4";
    const r2Key = `videos/${video.slug}/video.${ext}`;

    const buffer = await file.arrayBuffer();
    await c.env.STORAGE.put(r2Key, buffer, {
      httpMetadata: {
        contentType: file.type || (isHLS ? "application/vnd.apple.mpegurl" : "video/mp4"),
        cacheControl: "public, max-age=31536000",
      },
    });

    const localUrl = `/api/stream/${video.slug}/video.${ext}`;
    await c.env.DB.prepare(
      "UPDATE videos SET video_url = ?, file_size = ? WHERE id = ?"
    ).bind(localUrl, buffer.byteLength, id).run();

    return c.json({
      success: true,
      data: { url: localUrl, size: buffer.byteLength },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/upload/thumbnail/:id — direct thumbnail upload (browser → R2)
adminRoutes.post("/upload/thumbnail/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const video = await c.env.DB.prepare("SELECT slug FROM videos WHERE id = ?").bind(id).first<any>();
    if (!video) return c.json({ success: false, error: "Video not found" }, 404);

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return c.json({ success: false, error: "No file uploaded" }, 400);

    const ext = file.name.split(".").pop() || "jpg";
    const r2Key = `thumbnails/${video.slug}.${ext}`;

    const buffer = await file.arrayBuffer();
    await c.env.STORAGE.put(r2Key, buffer, {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=31536000",
      },
    });

    const localUrl = `/api/stream/thumb/${r2Key}`;
    await c.env.DB.prepare(
      "UPDATE videos SET thumbnail_url = ? WHERE id = ?"
    ).bind(localUrl, id).run();

    return c.json({
      success: true,
      data: { url: localUrl, size: buffer.byteLength },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/admin/upload/create — create video with direct file upload
adminRoutes.post("/upload/create", async (c) => {
  try {
    const formData = await c.req.formData();
    const videoFile = formData.get("video") as File | null;
    const thumbFile = formData.get("thumbnail") as File | null;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string || "";
    const duration = parseInt(formData.get("duration") as string || "0");
    const resolution = formData.get("resolution") as string || "720p";
    const tagsStr = formData.get("tags") as string || "[]";

    if (!title || !videoFile) {
      return c.json({ success: false, error: "Title and video file are required" }, 400);
    }

    const slug = generateSlug(title);

    // Upload video to R2
    const videoExt = videoFile.name.split(".").pop() || "mp4";
    const videoR2Key = `videos/${slug}/video.${videoExt}`;
    const videoBuffer = await videoFile.arrayBuffer();
    await c.env.STORAGE.put(videoR2Key, videoBuffer, {
      httpMetadata: {
        contentType: videoFile.type || "video/mp4",
        cacheControl: "public, max-age=31536000",
      },
    });
    const videoUrl = `/api/stream/${slug}/video.${videoExt}`;

    // Upload thumbnail if provided
    let thumbUrl: string | null = null;
    if (thumbFile) {
      const thumbExt = thumbFile.name.split(".").pop() || "jpg";
      const thumbR2Key = `thumbnails/${slug}.${thumbExt}`;
      const thumbBuffer = await thumbFile.arrayBuffer();
      await c.env.STORAGE.put(thumbR2Key, thumbBuffer, {
        httpMetadata: {
          contentType: thumbFile.type || "image/jpeg",
          cacheControl: "public, max-age=31536000",
        },
      });
      thumbUrl = `/api/stream/thumb/${thumbR2Key}`;
    }

    // Create DB record
    const result = await c.env.DB.prepare(
      `INSERT INTO videos (title, slug, description, duration, thumbnail_url, video_url,
       resolution, file_size, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).bind(
      title, slug, description, duration,
      thumbUrl, videoUrl, resolution, videoBuffer.byteLength,
      tagsStr
    ).run();

    return c.json({ success: true, data: { id: result.meta.last_row_id, slug } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

function generateSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 80);
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${slug}-${suffix}`;
}

