import { useState, useEffect } from "react";
import { apiFetch } from "../hooks/useApi";

interface SetupStatus {
  db_ready: boolean;
  admin_exists: boolean;
  r2_ready: boolean;
  site_name: string;
  needs_setup: boolean;
  error?: string;
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [adminForm, setAdminForm] = useState({
    username: "admin",
    email: "",
    password: "",
  });

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/setup/status");
      if (res.success) {
        setStatus(res.data);
        if (!res.data.needs_setup) {
          onComplete();
          return;
        }
        // Auto-determine step
        if (!res.data.db_ready) setStep(1);
        else if (!res.data.admin_exists) setStep(2);
        else onComplete();
      }
    } catch {
      setStatus({
        db_ready: false,
        admin_exists: false,
        r2_ready: false,
        site_name: "WTCHP",
        needs_setup: true,
        error: "Could not reach API",
      });
      setStep(1);
    }
    setLoading(false);
  };

  const handleInitDB = async () => {
    setActionLoading(true);
    setMessage("");
    try {
      const res = await apiFetch("/setup/init-db", { method: "POST" });
      if (res.success) {
        setMessage("✅ " + res.data.message);
        await checkStatus();
        setStep(2);
      } else {
        setMessage("❌ " + res.error);
      }
    } catch (err: any) {
      setMessage("❌ " + err.message);
    }
    setActionLoading(false);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setMessage("");
    try {
      const res = await apiFetch("/setup/create-admin", {
        method: "POST",
        body: adminForm,
      });
      if (res.success) {
        // Store JWT
        localStorage.setItem("token", res.data.token);
        setMessage("✅ " + res.data.message);
        setTimeout(() => {
          onComplete();
          window.location.reload();
        }, 1000);
      } else {
        setMessage("❌ " + res.error);
      }
    } catch (err: any) {
      setMessage("❌ " + err.message);
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "var(--bg-primary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 10001,
      }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "var(--bg-primary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 10001,
    }}>
      <div style={{
        width: "100%", maxWidth: 520, padding: "var(--space-2xl)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-lg)",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
          <div style={{
            fontSize: "var(--font-size-2xl)", fontWeight: 800,
            background: "var(--gradient-accent)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "var(--space-sm)",
          }}>
            {status?.site_name || "WTCHP"}
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-sm)" }}>
            Platform Setup Wizard
          </p>
        </div>

        {/* Steps indicator */}
        <div style={{
          display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-xl)",
          justifyContent: "center",
        }}>
          {[
            { n: 1, label: "Database" },
            { n: 2, label: "Admin" },
            { n: 3, label: "Done" },
          ].map((s) => (
            <div key={s.n} style={{
              display: "flex", alignItems: "center", gap: "var(--space-xs)",
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "var(--font-size-xs)", fontWeight: 700,
                background: step >= s.n ? "var(--accent)" : "var(--bg-surface-active)",
                color: step >= s.n ? "#fff" : "var(--text-tertiary)",
                transition: "all 0.3s ease",
              }}>
                {(step > s.n || (s.n === 1 && status?.db_ready)) ? "✓" : s.n}
              </div>
              <span style={{
                fontSize: "var(--font-size-xs)",
                color: step >= s.n ? "var(--text-primary)" : "var(--text-tertiary)",
              }}>
                {s.label}
              </span>
              {s.n < 3 && <span style={{ color: "var(--text-tertiary)", margin: "0 4px" }}>→</span>}
            </div>
          ))}
        </div>

        {/* Step 1: Init DB */}
        {step === 1 && (
          <div>
            <h3 style={{ marginBottom: "var(--space-md)", fontSize: "var(--font-size-lg)" }}>
              Initialize Database
            </h3>
            <p style={{
              color: "var(--text-secondary)", fontSize: "var(--font-size-sm)",
              marginBottom: "var(--space-lg)", lineHeight: 1.6,
            }}>
              This will create all required tables in your D1 database.
              Make sure you have created a D1 database and bound it in your <code style={{
                background: "var(--bg-surface-active)", padding: "1px 6px",
                borderRadius: "var(--radius-sm)", fontSize: "var(--font-size-xs)",
              }}>wrangler.jsonc</code> file.
            </p>

            {status?.error && (
              <div style={{
                padding: "var(--space-md)", marginBottom: "var(--space-md)",
                background: "rgba(255,71,87,0.1)", borderRadius: "var(--radius-md)",
                fontSize: "var(--font-size-sm)", color: "var(--error)",
              }}>
                ⚠ DB Connection Error: {status.error}
              </div>
            )}

            <button
              className="btn btn-primary btn-lg"
              style={{ width: "100%" }}
              onClick={handleInitDB}
              disabled={actionLoading}
            >
              {actionLoading ? "Initializing..." : "🗃 Initialize Database"}
            </button>
          </div>
        )}

        {/* Step 2: Create Admin */}
        {step === 2 && (
          <div>
            <h3 style={{ marginBottom: "var(--space-md)", fontSize: "var(--font-size-lg)" }}>
              Create Admin Account
            </h3>
            <p style={{
              color: "var(--text-secondary)", fontSize: "var(--font-size-sm)",
              marginBottom: "var(--space-lg)",
            }}>
              Set up your administrator account.
            </p>
            <form onSubmit={handleCreateAdmin}>
              <div className="form-group">
                <label>Username</label>
                <input
                  value={adminForm.username}
                  onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
                  required
                  minLength={3}
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                  required
                  placeholder="admin@example.com"
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ width: "100%", marginTop: "var(--space-sm)" }}
                disabled={actionLoading}
              >
                {actionLoading ? "Creating..." : "👤 Create Admin & Finish"}
              </button>
            </form>
          </div>
        )}

        {/* Message */}
        {message && (
          <div style={{
            marginTop: "var(--space-md)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--font-size-sm)",
            background: message.startsWith("✅") ? "rgba(46,213,115,0.1)" : "rgba(255,71,87,0.1)",
            color: message.startsWith("✅") ? "var(--success)" : "var(--error)",
          }}>
            {message}
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: "var(--space-xl)", paddingTop: "var(--space-md)",
          borderTop: "1px solid var(--border)",
          textAlign: "center", fontSize: "var(--font-size-xs)",
          color: "var(--text-tertiary)",
        }}>
          Cloudflare resources needed: D1 Database · R2 Bucket · KV Namespace
        </div>
      </div>
    </div>
  );
}
