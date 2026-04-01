import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { videoRoutes } from "./routes/videos";
import { categoryRoutes } from "./routes/categories";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { adminRoutes } from "./routes/admin";
import { searchRoutes } from "./routes/search";
import { streamRoutes } from "./routes/stream";
import { modelRoutes } from "./routes/models";
export { ViewCounter } from "./durable/viewCounter";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

const app = new Hono<HonoEnv>();

// Global middleware
app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Health check
app.get("/api/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "ok",
      name: c.env.SITE_NAME,
      timestamp: new Date().toISOString(),
    },
  });
});

// Mount routes
app.route("/api/auth", authRoutes);
app.route("/api/videos", videoRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/user", userRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/stream", streamRoutes);
app.route("/api/models", modelRoutes);

// 404 for API routes
app.all("/api/*", (c) => {
  return c.json({ success: false, error: "Not found" }, 404);
});

export default app;
