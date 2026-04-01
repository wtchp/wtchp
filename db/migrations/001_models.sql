-- Models feature migration

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
CREATE INDEX IF NOT EXISTS idx_video_models_model ON video_models(model_id);
