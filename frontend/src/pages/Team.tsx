import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { Layout, Spinner } from "../components";
import { useAuth, OrgRole } from "../auth";

interface Member {
  id: string;
  name: string | null;
  email: string;
  orgRole: OrgRole;
  verified: boolean;
  isYou: boolean;
}
interface Invite {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  createdAt: string;
}
interface OrgData {
  organization: { id: string; name: string };
  youCanManage: boolean;
  members: Member[];
  invites: Invite[];
}

const roleLabel: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export function TeamPage() {
  const { user } = useAuth();
  const [data, setData] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api<OrgData>("/org");
      setData(r);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await api<{ invite: { email: string; acceptUrl: string } }>("/org/invites", {
        method: "POST",
        body: { email, role },
      });
      setNotice(`Invitation emailed to ${r.invite.email}.`);
      setEmail("");
      setRole("MEMBER");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite(id: string) {
    setError(null);
    try {
      await api(`/org/invites/${id}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function changeRole(m: Member, next: "ADMIN" | "MEMBER") {
    setError(null);
    try {
      await api(`/org/members/${m.id}`, { method: "PATCH", body: { orgRole: next } });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.name ?? m.email} from the organization? Their projects stay theirs but leave the team's oversight.`)) return;
    setError(null);
    try {
      await api(`/org/members/${m.id}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!data) {
    return (
      <Layout>
        {error ? <div className="alert alert-error">{error}</div> : <Spinner />}
      </Layout>
    );
  }

  const canManage = data.youCanManage;

  return (
    <Layout>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{data.organization.name}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Your product team. Each PM runs their own projects; owners and admins can see and
            manage everyone's pilots.
          </p>
        </div>
        <span className="badge badge-accepted" style={{ alignSelf: "center" }}>
          You're {roleLabel[user?.orgRole ?? "MEMBER"]}
        </span>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {canManage && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={invite}>
          <h3 style={{ marginBottom: 10 }}>Invite a product manager</h3>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pm@yourcompany.com"
                required
              />
            </label>
            <label className="field" style={{ width: 180 }}>
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}>
                <option value="MEMBER">Member — runs their own</option>
                <option value="ADMIN">Admin — oversees all</option>
              </select>
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Members</h3>
        <div className="stack">
          {data.members.map((m) => (
            <div key={m.id} className="thread-row" style={{ cursor: "default" }}>
              <div>
                <b>{m.name ?? m.email}</b>
                {m.isYou && <span className="muted"> · you</span>}
                <div className="muted" style={{ fontSize: 13 }}>
                  {m.email}
                  {!m.verified && <span className="badge badge-invited" style={{ marginLeft: 8 }}>unverified</span>}
                </div>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span className={`badge ${m.orgRole === "OWNER" ? "badge-accepted" : "badge-invited"}`}>
                  {roleLabel[m.orgRole]}
                </span>
                {canManage && !m.isYou && m.orgRole !== "OWNER" && (
                  <>
                    {m.orgRole === "MEMBER" ? (
                      <button className="btn-ghost btn-sm" onClick={() => changeRole(m, "ADMIN")}>
                        Make admin
                      </button>
                    ) : (
                      <button className="btn-ghost btn-sm" onClick={() => changeRole(m, "MEMBER")}>
                        Make member
                      </button>
                    )}
                    <button className="btn-ghost btn-sm" onClick={() => removeMember(m)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {canManage && data.invites.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pending invites</h3>
          <div className="stack">
            {data.invites.map((i) => (
              <div key={i.id} className="thread-row" style={{ cursor: "default" }}>
                <div>
                  <b>{i.email}</b>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Invited {new Date(i.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="badge badge-invited">{roleLabel[i.role]}</span>
                  <button className="btn-ghost btn-sm" onClick={() => cancelInvite(i.id)}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
