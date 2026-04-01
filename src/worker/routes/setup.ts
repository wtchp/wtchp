import { Hono } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const setupRoutes = new Hono<HonoEnv>();

// GET /api/setup/status — check if platform is set up
setupRoutes.get("/status", async (c) => {
  try {
    // Check if DB tables exist
    const tableCheck = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first<{ name: string }>();

    const dbReady = !!tableCheck;

    // Check if admin exists
    let adminExists = false;
    if (dbReady) {
      const admin = await c.env.DB.prepare(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
      ).first();
      adminExists = !!admin;
    }

    // Check R2 binding
    const r2Ready = !!c.env.STORAGE;

    return c.json({
      success: true,
      data: {
        db_ready: dbReady,
        admin_exists: adminExists,
        r2_ready: r2Ready,
        site_name: c.env.SITE_NAME || "WTCHP",
        needs_setup: !dbReady || !adminExists,
      },
    });
  } catch (err: any) {
    return c.json({
      success: true,
      data: {
        db_ready: false,
        admin_exists: false,
        r2_ready: false,
        site_name: "WTCHP",
        needs_setup: true,
        error: err.message,
      },
    });
  }
});

// POST /api/setup/init-db — auto-run schema migrations
setupRoutes.post("/init-db", async (c) => {
  try {
    // Check if already initialized
    const tableCheck = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first();

    if (tableCheck) {
      return c.json({ success: true, data: { message: "Database already initialized" } });
    }

    // Run schema
    const schema = getSchema();
    const statements = schema.split(";").filter((s) => s.trim().length > 0);

    for (const stmt of statements) {
      try {
        await c.env.DB.prepare(stmt.trim() + ";").run();
      } catch (e: any) {
        // Ignore "already exists" errors
        if (!e.message.includes("already exists")) {
          console.error("Schema error:", e.message, "Statement:", stmt.trim().substring(0, 100));
        }
      }
    }

    // Run models migration
    const modelsMigration = getModelsMigration();
    const modelStmts = modelsMigration.split(";").filter((s) => s.trim().length > 0);
    for (const stmt of modelStmts) {
      try {
        await c.env.DB.prepare(stmt.trim() + ";").run();
      } catch (e: any) {
        if (!e.message.includes("already exists")) {
          console.error("Migration error:", e.message);
        }
      }
    }

    return c.json({ success: true, data: { message: "Database initialized successfully" } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// POST /api/setup/create-admin — create admin account (only if no admin exists)
setupRoutes.post("/create-admin", async (c) => {
  try {
    // Verify DB is ready
    const tableCheck = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first();
    if (!tableCheck) {
      return c.json({ success: false, error: "Database not initialized. Run init-db first." }, 400);
    }

    // Check if admin already exists
    const existingAdmin = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    ).first();
    if (existingAdmin) {
      return c.json({ success: false, error: "Admin account already exists. Use login instead." }, 400);
    }

    const { username, email, password } = await c.req.json();
    if (!username || !email || !password) {
      return c.json({ success: false, error: "username, email, and password are required" }, 400);
    }
    if (password.length < 6) {
      return c.json({ success: false, error: "Password must be at least 6 characters" }, 400);
    }

    // Hash password
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial, 256
    );
    const hashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const passwordHash = `pbkdf2:${saltHex}:${hashHex}`;

    // Create admin
    await c.env.DB.prepare(
      "INSERT INTO users (username, email, password_hash, role, display_name) VALUES (?, ?, ?, 'admin', ?)"
    ).bind(username, email, passwordHash, username).run();

    // Generate JWT
    const user = await c.env.DB.prepare("SELECT id, role, username FROM users WHERE email = ?").bind(email).first<any>();
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=/g, "");
    const payload = btoa(JSON.stringify({ id: user.id, role: user.role, username: user.username, iat: Math.floor(Date.now() / 1000) })).replace(/=/g, "");
    const signatureKey = await crypto.subtle.importKey("raw", encoder.encode(c.env.JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", signatureKey, encoder.encode(`${header}.${payload}`));
    const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const token = `${header}.${payload}.${sig}`;

    return c.json({ success: true, data: { token, message: "Admin account created!" } });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Inline schema — so the setup route is self-contained (no file reads needed in Workers)
function getSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    thumbnail_url TEXT,
    video_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    thumbnail_url TEXT,
    video_url TEXT NOT NULL,
    preview_url TEXT,
    resolution TEXT DEFAULT '720p',
    file_size INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    dislike_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'processing', 'inactive', 'deleted')),
    source TEXT,
    source_url TEXT,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS video_categories (
    video_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY (video_id, category_id),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS video_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    reaction TEXT NOT NULL CHECK(reaction IN ('like', 'dislike')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    parent_id INTEGER,
    body TEXT NOT NULL,
    like_count INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS view_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    user_id INTEGER,
    ip_hash TEXT,
    user_agent TEXT,
    country TEXT,
    viewed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    progress INTEGER DEFAULT 0,
    watched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_videos_slug ON videos(slug);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_video ON video_reactions(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_view_logs_video ON view_logs(video_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
`;
}

function getModelsMigration(): string {
  return `
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    bio TEXT,
    avatar_url TEXT,
    video_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS video_models (
    video_id INTEGER NOT NULL,
    model_id INTEGER NOT NULL,
    PRIMARY KEY (video_id, model_id),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_models_slug ON models(slug);
CREATE INDEX IF NOT EXISTS idx_video_models_video ON video_models(video_id);
CREATE INDEX IF NOT EXISTS idx_video_models_model ON video_models(model_id)
`;
}
