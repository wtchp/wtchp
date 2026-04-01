import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiFetch } from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ login: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: formData,
      });
      if (res.success) {
        login(res.data.token, res.data.user);
        navigate("/");
      } else {
        setError(res.error || "Login failed");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page page-enter">
      <div className="auth-card">
        <h1>Welcome Back</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username or Email</label>
            <input
              type="text"
              value={formData.login}
              onChange={(e) => setFormData({ ...formData, login: e.target.value })}
              placeholder="Enter username or email"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Enter password"
              required
            />
          </div>
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: "100%", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>
        <p style={{
          textAlign: "center",
          marginTop: "var(--space-lg)",
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
        }}>
          Don't have an account?{" "}
          <Link to="/register" style={{ color: "var(--accent)" }}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: "", email: "", password: "", display_name: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: formData,
      });
      if (res.success) {
        login(res.data.token, res.data.user);
        navigate("/");
      } else {
        setError(res.error || "Registration failed");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page page-enter">
      <div className="auth-card">
        <h1>Create Account</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="Choose a username"
              minLength={3}
              maxLength={30}
              required
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="your@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Display Name (optional)</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              placeholder="How you want to be shown"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Min 6 characters"
              minLength={6}
              required
            />
          </div>
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: "100%", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>
        <p style={{
          textAlign: "center",
          marginTop: "var(--space-lg)",
          fontSize: "var(--font-size-sm)",
          color: "var(--text-secondary)",
        }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--accent)" }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
