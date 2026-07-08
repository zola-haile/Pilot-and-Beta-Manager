import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";

interface AdminInvitePreview {
  company: { name: string };
  adminEmail: string;
  alreadySetUp: boolean;
  accountExists: boolean;
}

export function AdminAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [preview, setPreview] = useState<AdminInvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AdminInvitePreview>(`/auth/admin-invitations/${token}`, { auth: false })
      .then(setPreview)
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function accept(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>(
        `/auth/admin-invitations/${token}/accept`,
        { method: "POST", auth: false, body: preview?.accountExists ? {} : { name, password } }
      );
      login(res.token, res.user);
      navigate("/admin");
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
  if (!preview) return <div className="center-screen">Loading…</div>;

  return (
    <div className="center-screen">
      <div className="card container-narrow" style={{ width: "100%" }}>
        <h1>Company admin setup 🛠️</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          You've been made the administrator for <b>{preview.company.name}</b>, as{" "}
          <b>{preview.adminEmail}</b>.
        </p>
        <div className="alert alert-info">
          As admin you can invite your team into pilots (by email or a shareable link) and
          optionally take part yourself.
        </div>
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
            <p className="muted">You already have an account — accept to take on this admin role.</p>
          )}
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Setting up…" : "Set up admin account"}
          </button>
        </form>
      </div>
    </div>
  );
}
