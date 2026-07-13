import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";

interface InvitePreview {
  email: string;
  company: string;
  pilot: { name: string; description: string | null };
  status: string;
  accountExists: boolean;
}

export function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<InvitePreview>(`/auth/invitations/${token}`, { auth: false })
      .then((p) => setPreview(p))
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function accept(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>(
        `/auth/invitations/${token}/accept`,
        {
          method: "POST",
          auth: false,
          body: preview?.accountExists ? {} : { name, password },
        }
      );
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
          <h1>Invitation not found</h1>
          <p className="muted">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!preview) {
    return <div className="center-screen">Loading invitation…</div>;
  }

  const alreadyAccepted = preview.status === "ACCEPTED";

  return (
    <div className="center-screen">
      <div className="card container-narrow" style={{ width: "100%" }}>
        <h1>You're invited 🎉</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Join the <b>{preview.pilot.name}</b> pilot as <b>{preview.email}</b>
          {preview.company ? <> from <b>{preview.company}</b></> : null}.
        </p>
        {preview.pilot.description && (
          <div className="alert alert-info">{preview.pilot.description}</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={accept}>
          {!preview.accountExists && (
            <>
              <label className="field">
                <span>Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
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
            </>
          )}
          {preview.accountExists && (
            <p className="muted">
              You already have an account. Accept to add this pilot to it.
            </p>
          )}
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy
              ? "Joining…"
              : alreadyAccepted
              ? "Continue to pilot"
              : "Accept invitation"}
          </button>
        </form>
      </div>
    </div>
  );
}
