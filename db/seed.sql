-- Seed data for development
-- Run with: npm run db:seed

-- Categories
INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES
  ('Entertainment', 'entertainment', 'Fun and entertaining videos', 1),
  ('Education', 'education', 'Learn something new', 2),
  ('Technology', 'technology', 'Tech reviews, tutorials, and news', 3),
  ('Music', 'music', 'Music videos and performances', 4),
  ('Gaming', 'gaming', 'Game trailers, gameplay, and reviews', 5),
  ('Sports', 'sports', 'Sports highlights and replays', 6),
  ('Travel', 'travel', 'Travel vlogs and destination guides', 7),
  ('Cooking', 'cooking', 'Recipes and cooking tutorials', 8),
  ('Art', 'art', 'Creative art and design', 9),
  ('Science', 'science', 'Science experiments and explanations', 10);

-- Sample videos (using Big Buck Bunny as test content — public domain)
INSERT OR IGNORE INTO videos (title, slug, description, duration, video_url, thumbnail_url, resolution, view_count, like_count, tags, status) VALUES
  ('Big Buck Bunny - Full Movie', 'big-buck-bunny-full', 'Big Buck Bunny is a short open-source animated film made by the Blender Institute.', 596, 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'https://peach.blender.org/wp-content/uploads/bbb-splash.png', '1080p', 15420, 892, '["animation", "blender", "open-source", "movie"]', 'active'),
  ('Sintel - Trailer', 'sintel-trailer', 'Sintel is an open movie from the Blender Foundation.', 52, 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8', 'https://durian.blender.org/wp-content/uploads/2010/06/sintel_trailer_1080-1024x436.jpg', '1080p', 8320, 445, '["animation", "blender", "trailer", "fantasy"]', 'active'),
  ('Tears of Steel', 'tears-of-steel', 'Tears of Steel is a short film by the Blender Foundation.', 734, 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8', 'https://mango.blender.org/wp-content/gallery/4k-renders/01_thom_702_v6.jpg', '4K', 6150, 312, '["sci-fi", "blender", "short-film", "vfx"]', 'active'),
  ('Sample Video - Nature', 'sample-nature-demo', 'Beautiful nature footage for testing purposes.', 120, 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', '', '720p', 3200, 180, '["nature", "demo", "landscape"]', 'active'),
  ('Test Stream - Colors', 'test-stream-colors', 'A colorful test video stream.', 60, 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', '', '720p', 1500, 75, '["test", "demo", "colors"]', 'active');

-- Assign categories to videos
INSERT OR IGNORE INTO video_categories (video_id, category_id) VALUES
  (1, 1), (1, 9),  -- Big Buck Bunny -> Entertainment, Art
  (2, 1), (2, 9),  -- Sintel -> Entertainment, Art
  (3, 1), (3, 3),  -- Tears of Steel -> Entertainment, Technology
  (4, 7),           -- Nature -> Travel
  (5, 3);           -- Test Stream -> Technology

-- Update category counts
UPDATE categories SET video_count = (SELECT COUNT(*) FROM video_categories WHERE category_id = categories.id);
