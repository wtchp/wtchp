-- WTCHP Video Platform — Database Schema
-- Cloudflare D1 (SQLite)

-- ============================================
-- CATEGORIES
-- ============================================
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

-- ============================================
-- VIDEOS
-- ============================================
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

-- ============================================
-- VIDEO <-> CATEGORY (many-to-many)
-- ============================================
CREATE TABLE IF NOT EXISTS video_categories (
    video_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY (video_id, category_id),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- ============================================
-- USERS
-- ============================================
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

-- ============================================
-- FAVORITES (user bookmarks)
-- ============================================
CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

-- ============================================
-- LIKES / DISLIKES
-- ============================================
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

-- ============================================
-- COMMENTS
-- ============================================
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

-- ============================================
-- VIEW LOGS (analytics)
-- ============================================
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

-- ============================================
-- WATCH HISTORY
-- ============================================
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

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_videos_slug ON videos(slug);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_videos_likes ON videos(like_count DESC);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_video ON favorites(video_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON video_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_video ON video_reactions(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_view_logs_video ON view_logs(video_id);
CREATE INDEX IF NOT EXISTS idx_view_logs_date ON view_logs(viewed_at);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
