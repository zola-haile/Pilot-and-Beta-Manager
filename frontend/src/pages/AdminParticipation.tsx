import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";

interface AdminParticipant {
  id: string;
  email: string;
  name: string | null;
  status: string;
  joined: boolean;
  isYou: boolean;
  inviteUrl: string;
  entryCount: number;
}
interface Participation {
  id: string;
  company: { id: string; name: string };
  pilot: { id: string; name: string; description: string | null; status: string };
  shareUrl: string;
  selfEnrolled: boolean;
  participants: AdminParticipant[];
}

export function AdminParticipationPage() {
  const { pcId } = useParams();
  const [data, setData] = useState<Participation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api<{ participation: Participation }>(`/admin/participations/${pcId}`);
      setData(r.participation);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [pcId]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/admin/participations/${pcId}/participants`, {
        method: "POST",
        body: { email, name: name || null, sendEmail },
      });
      setNotice(sendEmail ? `Invitation sent to ${email}.` : `${email} added — copy their link below.`);
      setEmail("");
      setName("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(mid: string) {
    if (!confirm("Remove this person from the pilot?")) return;
    await api(`/admin/participations/${pcId}/participants/${mid}`, { method: "DELETE" });
    load();
  }

  async function selfEnroll() {
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/participations/${pcId}/self-enroll`, { method: "POST" });
      setNotice("You're now enrolled — switch to the Piloting view to fill in the pilot.");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setNotice(`${label} copied to clipboard.`);
  }

  if (error && !data) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!data) return <Layout><Spinner /></Layout>;

  return (
    <Layout>
      <Link to="/admin" className="muted" style={{ fontSize: 14 }}>
        ← Admin dashboard
      </Link>
      <div className="row" style={{ marginTop: 10 }}>
        <h1 style={{ margin: 0 }}>{data.pilot.name}</h1>
        <StatusBadge status={data.pilot.status} />
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Managing <b>{data.company.name}</b>'s participation.
      </p>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Share link */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Share a join link</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Anyone from {data.company.name} who opens this link can join the pilot directly.
        </p>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <span className="code-link" style={{ flex: 1, marginTop: 0 }}>{data.shareUrl}</span>
          <button className="btn-ghost btn-sm" onClick={() => copy(data.shareUrl, "Share link")}>
            Copy
          </button>
        </div>
      </div>

      {/* Self-enroll */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Take part yourself</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {data.selfEnrolled
                ? "You're enrolled in this pilot. Use the Piloting view to fill it in."
                : "Add yourself as a participant so you can fill in the pilot too."}
            </p>
          </div>
          {data.selfEnrolled ? (
            <Link to="/piloting" className="btn btn-sm">
              Piloting view →
            </Link>
          ) : (
            <button className="btn-sm" onClick={selfEnroll}>
              Add myself
            </button>
          )}
        </div>
      </div>

      {/* Participants */}
      <div className="card">
        <h2>People ({data.participants.length})</h2>
        {data.participants.length === 0 ? (
          <p className="muted">No one invited yet. Invite your team below.</p>
        ) : (
          <div>
            {data.participants.map((p) => (
              <div key={p.id} className="list-item">
                <div style={{ minWidth: 0 }}>
                  <div className="row">
                    <b>{p.name ?? p.email}</b>
                    {p.isYou && <span className="badge badge-upcoming">you</span>}
                    <span className={`badge badge-${p.status.toLowerCase()}`}>{p.status.toLowerCase()}</span>
                    {p.entryCount > 0 && (
                      <span className="badge badge-accepted">
                        {p.entryCount} {p.entryCount === 1 ? "entry" : "entries"}
                      </span>
                    )}
                  </div>
                  {p.name && <div className="muted" style={{ fontSize: 13 }}>{p.email}</div>}
                  {p.status === "INVITED" && <span className="code-link">{p.inviteUrl}</span>}
                </div>
                <div className="row">
                  {p.status === "INVITED" && (
                    <button className="btn-ghost btn-sm" onClick={() => copy(p.inviteUrl, "Invite link")}>
                      Copy link
                    </button>
                  )}
                  {!p.isYou && (
                    <button className="btn-danger btn-sm" onClick={() => remove(p.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={invite} style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
          <h3 style={{ marginBottom: 10 }}>Invite someone</h3>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="inline-check" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            <span>Email them the invite (otherwise just generate a link to share)</span>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add person"}
          </button>
        </form>
      </div>
    </Layout>
  );
}
