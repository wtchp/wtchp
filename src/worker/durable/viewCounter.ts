import { DurableObject } from "cloudflare:workers";

interface ViewState {
  count: number;
  lastSync: number;
  recentIPs: Map<string, number>;
}

export class ViewCounter extends DurableObject {
  private state: DurableObjectState;
  private viewCount: number = 0;
  private lastSync: number = 0;
  private recentIPs: Map<string, number> = new Map();

  constructor(state: DurableObjectState, env: any) {
    super(state, env);
    this.state = state;

    // Load persisted state
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<ViewState>("viewState");
      if (stored) {
        this.viewCount = stored.count;
        this.lastSync = stored.lastSync;
        this.recentIPs = new Map(Object.entries(stored.recentIPs || {}));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/increment" && request.method === "POST") {
      const { ipHash } = await request.json<{ videoId: number; userId?: number; ipHash: string }>();

      // Rate limit: same IP can only count once per 30 seconds
      const now = Date.now();
      const lastView = this.recentIPs.get(ipHash);
      if (lastView && now - lastView < 30000) {
        return new Response(JSON.stringify({ counted: false }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      this.recentIPs.set(ipHash, now);
      this.viewCount++;

      // Clean old IPs (older than 5 minutes)
      for (const [ip, time] of this.recentIPs) {
        if (now - time > 300000) this.recentIPs.delete(ip);
      }

      // Persist state
      await this.state.storage.put("viewState", {
        count: this.viewCount,
        lastSync: this.lastSync,
        recentIPs: Object.fromEntries(this.recentIPs),
      });

      return new Response(JSON.stringify({ counted: true, count: this.viewCount }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/count") {
      return new Response(JSON.stringify({ count: this.viewCount }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
