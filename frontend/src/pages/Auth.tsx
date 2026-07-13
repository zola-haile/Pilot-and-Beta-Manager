import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
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
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setResent(false);
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
      if (err instanceof ApiError && err.code === "EMAIL_UNVERIFIED") {
        setUnverified(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    try {
      await api("/auth/resend-verification", { method: "POST", auth: false, body: { email } });
      setResent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in to your account">
      {error && <div className="alert alert-error">{error}</div>}
      {unverified && (
        <div className="alert alert-info">
          Please verify your email before signing in. {resent ? (
            <b>Sent — check your inbox.</b>
          ) : (
            <button type="button" className="linkish" disabled={busy} onClick={resend}>
              Resend the link
            </button>
          )}
        </div>
      )}
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
        New here? <Link to="/register">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user } = useAuth();
  const [role, setRole] = useState<"PM" | "PARTICIPANT">("PM");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/register", {
        method: "POST",
        auth: false,
        body: { name, email, password, role },
      });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Almost there">
        <div className="alert alert-success">
          If <b>{email}</b> is available, we've sent a confirmation link to it. Click the
          link in that email to activate your account and sign in.
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 18, textAlign: "center" }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account">
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <span>I'm signing up to…</span>
          <div className="role-choice">
            <button
              type="button"
              className={role === "PM" ? "role-card role-on" : "role-card"}
              onClick={() => setRole("PM")}
            >
              <b>Run pilots</b>
              <small>Create programs, invite testers, review feedback.</small>
            </button>
            <button
              type="button"
              className={role === "PARTICIPANT" ? "role-card role-on" : "role-card"}
              onClick={() => setRole("PARTICIPANT")}
            >
              <b>Take part as a tester</b>
              <small>Join pilots you're invited to and give feedback.</small>
            </button>
          </div>
        </div>
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

// Landing for the email-confirmation link: verifies the token and signs in.
export function VerifyEmailPage() {
  const { token } = useParams();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ token: string; user: User }>(`/auth/verify/${token}`, { method: "POST", auth: false })
      .then((res) => {
        if (cancelled) return;
        login(res.token, res.user);
        navigate("/", { replace: true });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthShell title="Confirming your email">
      {error ? (
        <>
          <div className="alert alert-error">{error}</div>
          <p className="muted" style={{ marginBottom: 0, textAlign: "center" }}>
            <Link to="/login">Back to sign in</Link>
          </p>
        </>
      ) : (
        <p className="muted">One moment…</p>
      )}
    </AuthShell>
  );
}
