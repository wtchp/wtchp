// Shared types between worker and client

export interface Video {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  duration: number;
  thumbnail_url: string | null;
  video_url: string;
  preview_url: string | null;
  resolution: string;
  file_size: number;
  view_count: number;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  status: "active" | "processing" | "inactive" | "deleted";
  source: string | null;
  source_url: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  categories?: Category[];
  user_reaction?: "like" | "dislike" | null;
  is_favorited?: boolean;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  thumbnail_url: string | null;
  video_count: number;
  sort_order: number;
  created_at: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  is_active: number;
  last_login: string | null;
  created_at: string;
}

export interface Comment {
  id: number;
  user_id: number;
  video_id: number;
  parent_id: number | null;
  body: string;
  like_count: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  // Joined
  user?: Pick<User, "id" | "username" | "display_name" | "avatar_url">;
  replies?: Comment[];
}

export interface Favorite {
  id: number;
  user_id: number;
  video_id: number;
  created_at: string;
  video?: Video;
}

export interface VideoReaction {
  id: number;
  user_id: number;
  video_id: number;
  reaction: "like" | "dislike";
  created_at: string;
}

export interface WatchHistory {
  id: number;
  user_id: number;
  video_id: number;
  progress: number;
  watched_at: string;
  video?: Video;
}

// API Response types
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, "password_hash">;
}

// Query params
export interface VideoListParams {
  page?: number;
  per_page?: number;
  sort?: "newest" | "popular" | "most_liked" | "trending";
  category?: string;
  search?: string;
  status?: string;
}
