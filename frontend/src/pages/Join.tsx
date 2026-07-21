import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";

interface JoinPreview {
  pilot: { name: string; description: string | null };
  company: { name: string };
}

export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<JoinPreview>(`/join/${token}`, { auth: false })
      .then(setPreview)
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>(`/join/${token}/accept`, {
        method: "POST",
        auth: false,
        body: { email, name, password },
      });
      login(res.token, res.user);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="center-screen">
        <div className="card container-narrow" style={{ width: "100%" }}>
          <h1>Link not valid</h1>
          <p className="muted">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!preview) return <div className="center-screen">Loading…</div>;

  return (
    <div className="center-screen">
      <div className="card container-narrow" style={{ width: "100%" }}>
        <h1>Join the pilot</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Join <b>{preview.pilot.name}</b> as a participant from <b>{preview.company.name}</b>.
        </p>
        {preview.pilot.description && (
          <div className="alert alert-info">{preview.pilot.description}</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={join}>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Create a password</span>
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
            {busy ? "Joining…" : "Join pilot"}
          </button>
        </form>
      </div>
    </div>
  );
}
