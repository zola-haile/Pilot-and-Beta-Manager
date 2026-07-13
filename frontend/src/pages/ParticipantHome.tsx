import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, User } from "../auth";
import { Layout, Spinner, StatusBadge } from "../components";

interface MyPilot {
  id: string;
  name: string;
  description: string | null;
  status: string;
  questionCount: number;
  entryCount: number;
}

interface Invitation {
  token: string;
  pilot: { id: string; name: string; description: string | null };
  company: string;
}

interface AdminClaim {
  id: string;
  name: string;
}

/** Pulls a "/join/<token>" or "/invite/<token>" token out of a pasted link. */
function parseLink(input: string): { kind: "join" | "invite"; token: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  const join = raw.match(/\/join\/([^/?#\s]+)/);
  if (join) return { kind: "join", token: join[1] };
  const invite = raw.match(/\/invite\/([^/?#\s]+)/);
  if (invite) return { kind: "invite", token: invite[1] };
  // A bare token pasted in — treat it as a self-enroll share token.
  if (!raw.includes("/")) return { kind: "join", token: raw };
  return null;
}

export function ParticipantHomePage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [pilots, setPilots] = useState<MyPilot[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");

  async function load() {
    try {
      const [p, i, c] = await Promise.all([
        api<{ pilots: MyPilot[] }>("/my/pilots"),
        api<{ invitations: Invitation[] }>("/my/invitations"),
        api<{ claims: AdminClaim[] }>("/my/admin-claims"),
      ]);
      setPilots(p.pilots);
      setInvitations(i.invitations);
      setClaims(c.claims);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function acceptInvite(token: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/my/invitations/${token}/accept`, { method: "POST" });
      setNotice("You've joined the pilot.");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinByLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const parsed = parseLink(link);
    if (!parsed) {
      setError("That doesn't look like a pilot invite or join link.");
      return;
    }
    setBusy(true);
    try {
      if (parsed.kind === "join") {
        const r = await api<{ pilot: { name: string } }>("/my/join", {
          method: "POST",
          body: { token: parsed.token },
        });
        setNotice(`You've joined ${r.pilot.name}.`);
      } else {
        await api(`/my/invitations/${parsed.token}/accept`, { method: "POST" });
        setNotice("You've joined the pilot.");
      }
      setLink("");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function claimAdmin(companyId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ token: string; user: User }>(
        `/my/admin-claims/${companyId}/accept`,
        { method: "POST" }
      );
      login(res.token, res.user);
      navigate("/admin");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Layout>
      <h1>Your pilots</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Programs you're taking part in.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {claims.length > 0 && (
        <div className="card" style={{ borderColor: "var(--primary)" }}>
          <h2 style={{ marginTop: 0 }}>Company admin</h2>
          {claims.map((c) => (
            <div key={c.id} className="spread" style={{ marginTop: 8 }}>
              <span>
                You've been made admin of <b>{c.name}</b>.
              </span>
              <button disabled={busy} onClick={() => claimAdmin(c.id)}>
                Activate admin access
              </button>
            </div>
          ))}
        </div>
      )}

      {invitations.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pending invitations</h2>
          <div className="stack" style={{ marginTop: 10 }}>
            {invitations.map((inv) => (
              <div key={inv.token} className="spread">
                <div>
                  <b>{inv.pilot.name}</b>{" "}
                  <span className="muted">· via {inv.company}</span>
                  {inv.pilot.description && (
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      {inv.pilot.description}
                    </p>
                  )}
                </div>
                <button disabled={busy} onClick={() => acceptInvite(inv.token)}>
                  Accept
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!pilots ? (
        <Spinner />
      ) : pilots.length === 0 ? (
        <div className="card empty">
          You haven't joined any pilots yet. Paste an invite or join link below, or ask
          your program organizer to invite you.
        </div>
      ) : (
        <div className="stack">
          {pilots.map((p) => (
            <Link key={p.id} to={`/participate/${p.id}`} className="card card-link">
              <div className="spread">
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <div className="row">
                  {p.entryCount > 0 && (
                    <span className="badge badge-accepted">
                      {p.entryCount} {p.entryCount === 1 ? "entry" : "entries"}
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                </div>
              </div>
              {p.description && (
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {p.description}
                </p>
              )}
              <div className="stat-grid">
                <span className="stat">
                  <b>{p.questionCount}</b> questions to answer
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Have a link?</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Paste an invite or self-enroll link you were given to join a pilot with this
          account.
        </p>
        <form onSubmit={joinByLink} className="row" style={{ gap: 8 }}>
          <input
            style={{ flex: 1 }}
            placeholder="https://…/join/… or /invite/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="submit" disabled={busy || !link.trim()}>
            Join
          </button>
        </form>
      </div>
    </Layout>
  );
}
