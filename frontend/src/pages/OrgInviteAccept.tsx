import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";

interface OrgInvitePreview {
  organization: { name: string };
  email: string;
  role: "ADMIN" | "MEMBER";
  accepted: boolean;
  accountExists: boolean;
}

export function OrgInviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [preview, setPreview] = useState<OrgInvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<OrgInvitePreview>(`/auth/org-invitations/${token}`, { auth: false })
      .then(setPreview)
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function accept(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>(
        `/auth/org-invitations/${token}/accept`,
        { method: "POST", auth: false, body: preview?.accountExists ? {} : { name, password } }
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
  if (!preview) return <div className="center-screen">Loading…</div>;

  if (preview.accepted) {
    return (
      <div className="center-screen">
        <div className="card container-narrow" style={{ width: "100%" }}>
          <h1>Invitation already used</h1>
          <p className="muted">
            This invite to <b>{preview.organization.name}</b> has already been accepted. Try signing
            in instead.
          </p>
          <button style={{ width: "100%" }} onClick={() => navigate("/login")}>
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = preview.role === "ADMIN";

  return (
    <div className="center-screen">
      <div className="card container-narrow" style={{ width: "100%" }}>
        <h1>Join {preview.organization.name}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          You've been invited to join <b>{preview.organization.name}</b> as a product manager, as{" "}
          <b>{preview.email}</b>.
        </p>
        <div className="alert alert-info">
          {isAdmin
            ? "As an admin you can run your own pilots and oversee the whole team's programs."
            : "You'll be able to create and run your own pilot programs right away."}
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
            <p className="muted">You already have an account — accept to join this organization.</p>
          )}
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Joining…" : "Join the team"}
          </button>
        </form>
      </div>
    </div>
  );
}
