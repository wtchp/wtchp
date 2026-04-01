import { useState, useCallback } from "react";

const API_BASE = "/api";

interface FetchOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getToken = () => localStorage.getItem("auth_token");

  const request = useCallback(async <T = any>(
    endpoint: string,
    options: FetchOptions = {}
  ): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        ...options.headers,
      };

      const token = getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      if (options.body && !(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: options.method || "GET",
        headers,
        body: options.body instanceof FormData
          ? options.body
          : options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      return data as T;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { request, loading, error, setError };
}

// Simple fetch without state
export async function apiFetch<T = any>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: options.method || "GET",
    headers,
    body: options.body instanceof FormData
      ? options.body
      : options.body ? JSON.stringify(options.body) : undefined,
  });

  return res.json();
}
