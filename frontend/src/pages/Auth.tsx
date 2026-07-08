import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="center-screen">
      <div className="card container-narrow" style={{ width: "100%" }}>
        <h1 style={{ marginBottom: 4 }}>🚀 Pilot Manager</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 22 }}>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      login(res.token, res.user);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in to your account">
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted" style={{ marginBottom: 0, marginTop: 18, textAlign: "center" }}>
        New here? <Link to="/register">Create a PM account</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        auth: false,
        body: { name, email, password, role: "PM" },
      });
      login(res.token, res.user);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create a Product Manager account">
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <small className="muted">At least 8 characters.</small>
        </label>
        <button type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="muted" style={{ marginBottom: 0, marginTop: 18, textAlign: "center" }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
