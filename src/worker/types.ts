// Worker Env type definitions
export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  SESSIONS: KVNamespace;
  VIEW_COUNTER: DurableObjectNamespace;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_URL: string;
  JWT_SECRET: string;
  ADMIN_SETUP_KEY: string;
  R2_PUBLIC_URL: string;
}
