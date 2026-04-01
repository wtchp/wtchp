import { Hono } from "hono";
import type { Env } from "../types";
import { optionalAuth } from "../middleware/auth";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const videoRoutes = new Hono<HonoEnv>();

// GET /api/videos — list videos with pagination, sorting, filtering
videoRoutes.get("/", optionalAuth(), async (c) => {
  try {
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = Math.min(60, Math.max(1, parseInt(c.req.query("per_page") || "24")));
    const sort = c.req.query("sort") || "newest";
    const category = c.req.query("category");
    const offset = (page - 1) * perPage;

    let orderBy = "v.created_at DESC";
    if (sort === "popular") orderBy = "v.view_count DESC";
    if (sort === "most_liked") orderBy = "v.like_count DESC";
    if (sort === "oldest") orderBy = "v.created_at ASC";
    if (sort === "trending") orderBy = "v.view_count DESC, v.created_at DESC";

    let whereClause = "WHERE v.status = 'active'";
    const binds: any[] = [];

    if (category) {
      whereClause += " AND EXISTS (SELECT 1 FROM video_categories vc JOIN categories cat ON vc.category_id = cat.id WHERE vc.video_id = v.id AND cat.slug = ?)";
      binds.push(category);
    }

    // Count
    const countQuery = `SELECT COUNT(*) as total FROM videos v ${whereClause}`;
    const countResult = await c.env.DB.prepare(countQuery).bind(...binds).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Fetch
    const query = `SELECT v.* FROM videos v ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const { results } = await c.env.DB.prepare(query).bind(...binds, perPage, offset).all();

    // Fetch categories for each video
    const videoIds = results.map((v: any) => v.id);
    let categoryMap: Record<number, any[]> = {};
    if (videoIds.length > 0) {
      const placeholders = videoIds.map(() => "?").join(",");
      const catQuery = `
        SELECT vc.video_id, c.id, c.name, c.slug 
        FROM video_categories vc 
        JOIN categories c ON vc.category_id = c.id 
        WHERE vc.video_id IN (${placeholders})
      `;
      const { results: cats } = await c.env.DB.prepare(catQuery).bind(...videoIds).all();
      for (const cat of cats as any[]) {
        if (!categoryMap[cat.video_id]) categoryMap[cat.video_id] = [];
        categoryMap[cat.video_id].push({ id: cat.id, name: cat.name, slug: cat.slug });
      }
    }

    const data = results.map((v: any) => ({
      ...v,
      tags: JSON.parse(v.tags || "[]"),
      categories: categoryMap[v.id] || [],
    }));

    return c.json({
      success: true,
      data,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/videos/trending
videoRoutes.get("/trending", async (c) => {
  try {
    const limit = Math.min(24, parseInt(c.req.query("limit") || "12"));
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM videos WHERE status = 'active' 
       ORDER BY view_count DESC, created_at DESC LIMIT ?`
    ).bind(limit).all();

    return c.json({
      success: true,
      data: results.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/videos/recent
videoRoutes.get("/recent", async (c) => {
  try {
    const limit = Math.min(24, parseInt(c.req.query("limit") || "12"));
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE status = 'active' ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();

    return c.json({
      success: true,
      data: results.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/videos/:slug — single video detail
videoRoutes.get("/:slug", optionalAuth(), async (c) => {
  try {
    const slug = c.req.param("slug");
    const userId = c.get("userId");

    const video = await c.env.DB.prepare(
      "SELECT * FROM videos WHERE slug = ? AND status = 'active'"
    ).bind(slug).first<any>();

    if (!video) {
      return c.json({ success: false, error: "Video not found" }, 404);
    }

    // Get categories
    const { results: categories } = await c.env.DB.prepare(
      "SELECT c.id, c.name, c.slug FROM video_categories vc JOIN categories c ON vc.category_id = c.id WHERE vc.video_id = ?"
    ).bind(video.id).all();

    // Get models
    const { results: models } = await c.env.DB.prepare(
      "SELECT m.id, m.name, m.slug, m.avatar_url FROM video_models vm JOIN models m ON vm.model_id = m.id WHERE vm.video_id = ?"
    ).bind(video.id).all();

    // Get user reaction & favorite status
    let user_reaction = null;
    let is_favorited = false;
    if (userId) {
      const reaction = await c.env.DB.prepare(
        "SELECT reaction FROM video_reactions WHERE user_id = ? AND video_id = ?"
      ).bind(userId, video.id).first<any>();
      user_reaction = reaction?.reaction || null;

      const fav = await c.env.DB.prepare(
        "SELECT id FROM favorites WHERE user_id = ? AND video_id = ?"
      ).bind(userId, video.id).first();
      is_favorited = !!fav;
    }

    // Get related videos (same categories)
    const catIds = (categories as any[]).map((cat: any) => cat.id);
    let related: any[] = [];
    if (catIds.length > 0) {
      const placeholders = catIds.map(() => "?").join(",");
      const { results: rel } = await c.env.DB.prepare(
        `SELECT DISTINCT v.* FROM videos v 
         JOIN video_categories vc ON v.id = vc.video_id 
         WHERE vc.category_id IN (${placeholders}) AND v.id != ? AND v.status = 'active'
         ORDER BY v.view_count DESC LIMIT 12`
      ).bind(...catIds, video.id).all();
      related = rel.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") }));
    }

    return c.json({
      success: true,
      data: {
        ...video,
        tags: JSON.parse(video.tags || "[]"),
        categories,
        models,
        user_reaction,
        is_favorited,
        related,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/videos/:id/view — record a view
videoRoutes.post("/:id/view", optionalAuth(), async (c) => {
  try {
    const videoId = parseInt(c.req.param("id"));
    const userId = c.get("userId");

    // Use Durable Object for view counting
    const doId = c.env.VIEW_COUNTER.idFromName(`video-${videoId}`);
    const stub = c.env.VIEW_COUNTER.get(doId);

    const ipHash = await hashIP(c.req.header("CF-Connecting-IP") || "unknown");

    await stub.fetch("https://internal/increment", {
      method: "POST",
      body: JSON.stringify({ videoId, userId, ipHash }),
    });

    // Also update D1 directly (DO will batch-sync for accuracy)
    await c.env.DB.prepare(
      "UPDATE videos SET view_count = view_count + 1 WHERE id = ?"
    ).bind(videoId).run();

    // Log the view
    await c.env.DB.prepare(
      "INSERT INTO view_logs (video_id, user_id, ip_hash, country) VALUES (?, ?, ?, ?)"
    ).bind(
      videoId,
      userId || null,
      ipHash,
      c.req.header("CF-IPCountry") || null
    ).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + "salt_for_privacy");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
