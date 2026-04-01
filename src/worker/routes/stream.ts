import { Hono } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const streamRoutes = new Hono<HonoEnv>();

// IMPORTANT: Specific routes MUST come before the wildcard /:slug/*

// Serve thumbnails from R2
streamRoutes.get("/thumb/*", async (c) => {
  try {
    const r2Key = c.req.path.replace("/api/stream/thumb/", "");

    if (!r2Key) {
      return c.json({ success: false, error: "Path required" }, 400);
    }

    const object = await c.env.STORAGE.get(r2Key);
    if (!object) {
      return c.json({ success: false, error: "Not found" }, 404);
    }

    let contentType = "image/jpeg";
    if (r2Key.endsWith(".png")) contentType = "image/png";
    if (r2Key.endsWith(".webp")) contentType = "image/webp";
    if (r2Key.endsWith(".gif")) contentType = "image/gif";

    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/stream/comments/:videoId — public comments
streamRoutes.get("/comments/:videoId", async (c) => {
  try {
    const videoId = parseInt(c.req.param("videoId"));
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM comments WHERE video_id = ? AND parent_id IS NULL"
    ).bind(videoId).first<{ total: number }>();

    const { results: comments } = await c.env.DB.prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.video_id = ? AND c.parent_id IS NULL
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    ).bind(videoId, perPage, offset).all();

    const commentIds = comments.map((c: any) => c.id);
    let replies: Record<number, any[]> = {};
    if (commentIds.length > 0) {
      const placeholders = commentIds.map(() => "?").join(",");
      const { results: allReplies } = await c.env.DB.prepare(
        `SELECT c.*, u.username, u.display_name, u.avatar_url
         FROM comments c JOIN users u ON c.user_id = u.id
         WHERE c.parent_id IN (${placeholders})
         ORDER BY c.created_at ASC`
      ).bind(...commentIds).all();

      for (const reply of allReplies as any[]) {
        if (!replies[reply.parent_id]) replies[reply.parent_id] = [];
        replies[reply.parent_id].push(reply);
      }
    }

    const data = comments.map((c: any) => ({
      ...c,
      replies: replies[c.id] || [],
    }));

    return c.json({
      success: true,
      data,
      total: countResult?.total || 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((countResult?.total || 0) / perPage),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/stream/:slug/* — serve video files from R2 (MUST be last — wildcard)
streamRoutes.get("/:slug/*", async (c) => {
  try {
    const slug = c.req.param("slug");
    const path = c.req.path.replace(`/api/stream/${slug}/`, "");

    if (!path) {
      return c.json({ success: false, error: "File path required" }, 400);
    }

    const r2Key = `videos/${slug}/${path}`;
    const object = await c.env.STORAGE.get(r2Key);

    if (!object) {
      return c.json({ success: false, error: `File not found: ${r2Key}` }, 404);
    }

    // Determine content type
    let contentType = "application/octet-stream";
    if (path.endsWith(".m3u8")) contentType = "application/vnd.apple.mpegurl";
    else if (path.endsWith(".mpd")) contentType = "application/dash+xml";
    else if (path.endsWith(".ts")) contentType = "video/mp2t";
    else if (path.endsWith(".mp4")) contentType = "video/mp4";
    else if (path.endsWith(".webm")) contentType = "video/webm";
    else if (path.endsWith(".m4s")) contentType = "video/iso.segment";

    // Cache headers
    const cacheControl = (path.endsWith(".m3u8") || path.endsWith(".mpd"))
      ? "public, max-age=5"
      : "public, max-age=31536000, immutable";

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });

    if (object.size) {
      headers.set("Content-Length", object.size.toString());
    }

    // Range request support for video seeking
    const range = c.req.header("Range");
    if (range && object.size) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : object.size - 1;

        // Re-fetch with range
        const rangeObject = await c.env.STORAGE.get(r2Key, {
          range: { offset: start, length: end - start + 1 },
        });

        if (rangeObject) {
          return new Response(rangeObject.body, {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Range": `bytes ${start}-${end}/${object.size}`,
              "Content-Length": (end - start + 1).toString(),
              "Accept-Ranges": "bytes",
              "Cache-Control": cacheControl,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }
    }

    headers.set("Accept-Ranges", "bytes");
    return new Response(object.body, { headers });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
