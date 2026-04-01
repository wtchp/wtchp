import { Hono } from "hono";
import type { Env } from "../types";
import { hashPassword, verifyPassword, createJWT } from "../middleware/auth";
import { optionalAuth } from "../middleware/auth";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

export const authRoutes = new Hono<HonoEnv>();

// POST /api/auth/register
authRoutes.post("/register", async (c) => {
  try {
    const { username, email, password, display_name } = await c.req.json();

    if (!username || !email || !password) {
      return c.json({ success: false, error: "Username, email, and password are required" }, 400);
    }
    if (password.length < 6) {
      return c.json({ success: false, error: "Password must be at least 6 characters" }, 400);
    }
    if (username.length < 3 || username.length > 30) {
      return c.json({ success: false, error: "Username must be 3-30 characters" }, 400);
    }
    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ success: false, error: "Invalid email format" }, 400);
    }

    // Check if user exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE username = ? OR email = ?"
    ).bind(username, email).first();

    if (existing) {
      return c.json({ success: false, error: "Username or email already taken" }, 409);
    }

    const password_hash = await hashPassword(password);

    const result = await c.env.DB.prepare(
      "INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)"
    ).bind(username, email, password_hash, display_name || username).run();

    const userId = result.meta.last_row_id;
    const token = await createJWT({ id: userId, role: "user", username }, c.env.JWT_SECRET);

    return c.json({
      success: true,
      data: {
        token,
        user: { id: userId, username, email, display_name: display_name || username, role: "user" },
      },
    }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message || "Registration failed" }, 500);
  }
});

// POST /api/auth/login
authRoutes.post("/login", async (c) => {
  try {
    const { login, password } = await c.req.json();

    if (!login || !password) {
      return c.json({ success: false, error: "Login and password are required" }, 400);
    }

    const user = await c.env.DB.prepare(
      "SELECT * FROM users WHERE username = ? OR email = ?"
    ).bind(login, login).first<any>();

    if (!user) {
      return c.json({ success: false, error: "Invalid credentials" }, 401);
    }
    if (!user.is_active) {
      return c.json({ success: false, error: "Account is disabled" }, 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return c.json({ success: false, error: "Invalid credentials" }, 401);
    }

    // Update last login
    await c.env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")
      .bind(user.id).run();

    const token = await createJWT(
      { id: user.id, role: user.role, username: user.username },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          role: user.role,
        },
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || "Login failed" }, 500);
  }
});

// GET /api/auth/me
authRoutes.get("/me", optionalAuth(), async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ success: false, error: "Not authenticated" }, 401);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, username, email, display_name, avatar_url, role, created_at FROM users WHERE id = ?"
  ).bind(userId).first();

  if (!user) {
    return c.json({ success: false, error: "User not found" }, 404);
  }

  return c.json({ success: true, data: user });
});

// POST /api/auth/setup-admin — one-time admin setup
authRoutes.post("/setup-admin", async (c) => {
  try {
    const { setup_key, username, email, password } = await c.req.json();

    if (setup_key !== c.env.ADMIN_SETUP_KEY) {
      return c.json({ success: false, error: "Invalid setup key" }, 403);
    }

    // Check if admin already exists
    const existingAdmin = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    ).first();

    if (existingAdmin) {
      return c.json({ success: false, error: "Admin already exists" }, 409);
    }

    const password_hash = await hashPassword(password);

    const result = await c.env.DB.prepare(
      "INSERT INTO users (username, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, 'admin')"
    ).bind(username, email, password_hash, username).run();

    const token = await createJWT(
      { id: result.meta.last_row_id, role: "admin", username },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      data: { token, message: "Admin account created successfully" },
    }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
