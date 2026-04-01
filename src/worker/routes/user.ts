import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth } from "../middleware/auth";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const userRoutes = new Hono<HonoEnv>();

// All user routes require auth
userRoutes.use("*", requireAuth());

// POST /api/user/favorites/:videoId — toggle favorite
userRoutes.post("/favorites/:videoId", async (c) => {
  try {
    const userId = c.get("userId")!;
    const videoId = parseInt(c.req.param("videoId"));

    const existing = await c.env.DB.prepare(
      "SELECT id FROM favorites WHERE user_id = ? AND video_id = ?"
    ).bind(userId, videoId).first();

    if (existing) {
      await c.env.DB.prepare("DELETE FROM favorites WHERE user_id = ? AND video_id = ?")
        .bind(userId, videoId).run();
      return c.json({ success: true, data: { favorited: false } });
    } else {
      await c.env.DB.prepare("INSERT INTO favorites (user_id, video_id) VALUES (?, ?)")
        .bind(userId, videoId).run();
      return c.json({ success: true, data: { favorited: true } });
    }
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/user/favorites — list favorites
userRoutes.get("/favorites", async (c) => {
  try {
    const userId = c.get("userId")!;
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = Math.min(60, parseInt(c.req.query("per_page") || "24"));
    const offset = (page - 1) * perPage;

    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM favorites WHERE user_id = ?"
    ).bind(userId).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(
      `SELECT v.*, f.created_at as favorited_at FROM favorites f 
       JOIN videos v ON f.video_id = v.id 
       WHERE f.user_id = ? AND v.status = 'active'
       ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
    ).bind(userId, perPage, offset).all();

    return c.json({
      success: true,
      data: results.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
      total: countResult?.total || 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((countResult?.total || 0) / perPage),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/user/reactions/:videoId — like/dislike toggle
userRoutes.post("/reactions/:videoId", async (c) => {
  try {
    const userId = c.get("userId")!;
    const videoId = parseInt(c.req.param("videoId"));
    const { reaction } = await c.req.json<{ reaction: "like" | "dislike" }>();

    if (!["like", "dislike"].includes(reaction)) {
      return c.json({ success: false, error: "Invalid reaction" }, 400);
    }

    const existing = await c.env.DB.prepare(
      "SELECT id, reaction FROM video_reactions WHERE user_id = ? AND video_id = ?"
    ).bind(userId, videoId).first<any>();

    if (existing) {
      if (existing.reaction === reaction) {
        // Remove reaction
        await c.env.DB.prepare("DELETE FROM video_reactions WHERE id = ?").bind(existing.id).run();
        const field = reaction === "like" ? "like_count" : "dislike_count";
        await c.env.DB.prepare(`UPDATE videos SET ${field} = MAX(0, ${field} - 1) WHERE id = ?`)
          .bind(videoId).run();
        return c.json({ success: true, data: { reaction: null } });
      } else {
        // Switch reaction
        await c.env.DB.prepare("UPDATE video_reactions SET reaction = ? WHERE id = ?")
          .bind(reaction, existing.id).run();
        const addField = reaction === "like" ? "like_count" : "dislike_count";
        const removeField = reaction === "like" ? "dislike_count" : "like_count";
        await c.env.DB.prepare(
          `UPDATE videos SET ${addField} = ${addField} + 1, ${removeField} = MAX(0, ${removeField} - 1) WHERE id = ?`
        ).bind(videoId).run();
        return c.json({ success: true, data: { reaction } });
      }
    } else {
      await c.env.DB.prepare(
        "INSERT INTO video_reactions (user_id, video_id, reaction) VALUES (?, ?, ?)"
      ).bind(userId, videoId, reaction).run();
      const field = reaction === "like" ? "like_count" : "dislike_count";
      await c.env.DB.prepare(`UPDATE videos SET ${field} = ${field} + 1 WHERE id = ?`)
        .bind(videoId).run();
      return c.json({ success: true, data: { reaction } });
    }
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/user/comments/:videoId — get comments for a video
userRoutes.get("/comments/:videoId", async (c) => {
  // This is also accessible without auth, handled in videos route
  return c.json({ success: false, error: "Use GET /api/videos/:slug for comments" }, 301);
});

// POST /api/user/comments/:videoId — post a comment
userRoutes.post("/comments/:videoId", async (c) => {
  try {
    const userId = c.get("userId")!;
    const videoId = parseInt(c.req.param("videoId"));
    const { body, parent_id } = await c.req.json<{ body: string; parent_id?: number }>();

    if (!body?.trim() || body.trim().length < 1) {
      return c.json({ success: false, error: "Comment body is required" }, 400);
    }
    if (body.length > 2000) {
      return c.json({ success: false, error: "Comment too long (max 2000 chars)" }, 400);
    }

    const result = await c.env.DB.prepare(
      "INSERT INTO comments (user_id, video_id, parent_id, body) VALUES (?, ?, ?, ?)"
    ).bind(userId, videoId, parent_id || null, body.trim()).run();

    // Update comment count
    await c.env.DB.prepare(
      "UPDATE videos SET comment_count = comment_count + 1 WHERE id = ?"
    ).bind(videoId).run();

    // Fetch created comment with user info
    const comment = await c.env.DB.prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url 
       FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?`
    ).bind(result.meta.last_row_id).first();

    return c.json({ success: true, data: comment }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// DELETE /api/user/comments/:commentId — delete own comment
userRoutes.delete("/comments/:commentId", async (c) => {
  try {
    const userId = c.get("userId")!;
    const commentId = parseInt(c.req.param("commentId"));

    const comment = await c.env.DB.prepare(
      "SELECT * FROM comments WHERE id = ?"
    ).bind(commentId).first<any>();

    if (!comment) {
      return c.json({ success: false, error: "Comment not found" }, 404);
    }

    if (comment.user_id !== userId && c.get("userRole") !== "admin") {
      return c.json({ success: false, error: "Not authorized" }, 403);
    }

    await c.env.DB.prepare("UPDATE comments SET is_deleted = 1, body = '[deleted]' WHERE id = ?")
      .bind(commentId).run();

    await c.env.DB.prepare(
      "UPDATE videos SET comment_count = MAX(0, comment_count - 1) WHERE id = ?"
    ).bind(comment.video_id).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/user/history — watch history
userRoutes.get("/history", async (c) => {
  try {
    const userId = c.get("userId")!;
    const page = Math.max(1, parseInt(c.req.query("page") || "1"));
    const perPage = 24;
    const offset = (page - 1) * perPage;

    const { results } = await c.env.DB.prepare(
      `SELECT v.*, wh.progress, wh.watched_at FROM watch_history wh
       JOIN videos v ON wh.video_id = v.id
       WHERE wh.user_id = ? AND v.status = 'active'
       ORDER BY wh.watched_at DESC LIMIT ? OFFSET ?`
    ).bind(userId, perPage, offset).all();

    return c.json({
      success: true,
      data: results.map((v: any) => ({ ...v, tags: JSON.parse(v.tags || "[]") })),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/user/history/:videoId — update watch progress
userRoutes.post("/history/:videoId", async (c) => {
  try {
    const userId = c.get("userId")!;
    const videoId = parseInt(c.req.param("videoId"));
    const { progress } = await c.req.json<{ progress: number }>();

    await c.env.DB.prepare(
      `INSERT INTO watch_history (user_id, video_id, progress, watched_at) 
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, video_id) DO UPDATE SET progress = ?, watched_at = datetime('now')`
    ).bind(userId, videoId, progress, progress).run();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
