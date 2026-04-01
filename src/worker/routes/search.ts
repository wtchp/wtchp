import { Hono } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const searchRoutes = new Hono<HonoEnv>();

// GET /api/search?q=...
searchRoutes.get("/", async (c) => {
  try {
    const q = c.req.query("q")?.trim();
    if (!q || q.length < 2) {
      return c.json({ success: false, error: "Search query must be at least 2 characters" }, 400);
    }

    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = Math.min(60, parseInt(c.req.query("per_page") || "24"));
    const offset = (page - 1) * perPage;
    const searchTerm = `%${q}%`;

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM videos 
       WHERE status = 'active' AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)`
    ).bind(searchTerm, searchTerm, searchTerm).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM videos 
       WHERE status = 'active' AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)
       ORDER BY 
         CASE WHEN title LIKE ? THEN 0 ELSE 1 END,
         view_count DESC
       LIMIT ? OFFSET ?`
    ).bind(searchTerm, searchTerm, searchTerm, searchTerm, perPage, offset).all();

    return c.json({
      success: true,
      data: results.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
      query: q,
      total: countResult?.total || 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((countResult?.total || 0) / perPage),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/search/suggestions?q=...
searchRoutes.get("/suggestions", async (c) => {
  try {
    const q = c.req.query("q")?.trim();
    if (!q || q.length < 2) {
      return c.json({ success: true, data: [] });
    }

    const { results } = await c.env.DB.prepare(
      `SELECT title, slug FROM videos 
       WHERE status = 'active' AND title LIKE ?
       ORDER BY view_count DESC LIMIT 8`
    ).bind(`%${q}%`).all();

    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
