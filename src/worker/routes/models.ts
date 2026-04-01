import { Hono } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const modelRoutes = new Hono<HonoEnv>();

// GET /api/models — list all models
modelRoutes.get("/", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM models ORDER BY name ASC"
    ).all();
    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/models/:slug — model detail with videos
modelRoutes.get("/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = Math.min(60, parseInt(c.req.query("per_page") || "24"));
    const offset = (page - 1) * perPage;

    const model = await c.env.DB.prepare("SELECT * FROM models WHERE slug = ?")
      .bind(slug).first();

    if (!model) {
      return c.json({ success: false, error: "Model not found" }, 404);
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM videos v
       JOIN video_models vm ON v.id = vm.video_id
       WHERE vm.model_id = ? AND v.status = 'active'`
    ).bind((model as any).id).first<{ total: number }>();

    const { results: videos } = await c.env.DB.prepare(
      `SELECT v.* FROM videos v
       JOIN video_models vm ON v.id = vm.video_id
       WHERE vm.model_id = ? AND v.status = 'active'
       ORDER BY v.created_at DESC LIMIT ? OFFSET ?`
    ).bind((model as any).id, perPage, offset).all();

    return c.json({
      success: true,
      data: {
        model,
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
