import { Hono } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const categoryRoutes = new Hono<HonoEnv>();

// GET /api/categories — all categories
categoryRoutes.get("/", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM categories ORDER BY sort_order ASC, name ASC"
    ).all();

    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/categories/:slug — category detail with videos
categoryRoutes.get("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = Math.min(60, parseInt(c.req.query("per_page") || "24"));
    const sort = c.req.query("sort") || "newest";
    const offset = (page - 1) * perPage;

    const category = await c.env.DB.prepare(
      "SELECT * FROM categories WHERE slug = ?"
    ).bind(slug).first();

    if (!category) {
      return c.json({ success: false, error: "Category not found" }, 404);
    }

    let orderBy = "v.created_at DESC";
    if (sort === "popular") orderBy = "v.view_count DESC";
    if (sort === "most_liked") orderBy = "v.like_count DESC";

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM videos v 
       JOIN video_categories vc ON v.id = vc.video_id 
       WHERE vc.category_id = ? AND v.status = 'active'`
    ).bind((category as any).id).first<{ total: number }>();

    const { results: videos } = await c.env.DB.prepare(
      `SELECT v.* FROM videos v 
       JOIN video_categories vc ON v.id = vc.video_id 
       WHERE vc.category_id = ? AND v.status = 'active'
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).bind((category as any).id, perPage, offset).all();

    return c.json({
      success: true,
      data: {
        category,
        videos: videos.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
        total: countResult?.total || 0,
        page,
        per_page: perPage,
        total_pages: Math.ceil((countResult?.total || 0) / perPage),
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
