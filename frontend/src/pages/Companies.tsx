import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";

interface Company {
  id: string;
  name: string;
  adminEmail: string;
  adminJoined: boolean;
  participantCount: number;
}

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendAdminInvite(e: React.MouseEvent, c: Company) {
    e.preventDefault(); // don't follow the card's link
    e.stopPropagation();
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ alreadyActive: boolean }>(`/companies/${c.id}/invite-admin`, {
        method: "POST",
      });
      setNotice(
        r.alreadyActive
          ? `Reminder emailed to ${c.adminEmail} (already an active admin).`
          : `Admin invite emailed to ${c.adminEmail}.`
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function load() {
    try {
      const r = await api<{ companies: Company[] }>("/companies");
      setCompanies(r.companies);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/companies", { method: "POST", body: { name, adminEmail } });
      setName("");
      setAdminEmail("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <h1>Companies</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Your partner organizations — reusable across pilots in any of your projects. Each has an
        admin who invites their own people. Click a company to see its people.
      </p>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" style={{ marginBottom: 20 }} onSubmit={add}>
        <h3 style={{ marginBottom: 10 }}>Add a company</h3>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Company name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CP Inc." required />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Admin email</span>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@company.com"
              required
            />
          </label>
        </div>
        <button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add company"}
        </button>
      </form>

      {!companies ? (
        <Spinner />
      ) : companies.length === 0 ? (
        <div className="card empty">No companies yet. Add one above.</div>
      ) : (
        <div className="stack">
          {companies.map((c) => (
            <Link key={c.id} to={`/companies/${c.id}`} className="card card-link">
              <div className="spread">
                <div>
                  <h2 style={{ margin: 0 }}>{c.name}</h2>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    Admin: {c.adminEmail}{" "}
                    <span className={`badge ${c.adminJoined ? "badge-accepted" : "badge-invited"}`}>
                      {c.adminJoined ? "active" : "pending"}
                    </span>
                  </div>
                </div>
                <div className="row">
                  <span className="stat">
                    <b>{c.participantCount}</b> {c.participantCount === 1 ? "person" : "people"}
                  </span>
                  <button className="btn-ghost btn-sm" onClick={(e) => sendAdminInvite(e, c)}>
                    {c.adminJoined ? "Re-send admin" : "Send admin invite"}
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}

interface PilotRef {
  pilotId: string;
  pilotName: string;
  appName: string;
  status: string;
  membershipStatus: string;
  entryCount: number;
}
interface CompanyParticipant {
  id: string;
  email: string;
  name: string | null;
  joined: boolean;
  pilots: PilotRef[];
}
interface CompanyDetail {
  company: { id: string; name: string; adminEmail: string; adminJoined: boolean };
  participants: CompanyParticipant[];
}

export function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<CompanyDetail>(`/companies/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }
  useEffect(() => {
    load();
  }, [id]);

  async function deleteCompany() {
    if (
      !confirm(
        "Delete this company? This removes the company, all its people, their pilot memberships and their responses. This cannot be undone."
      )
    )
      return;
    try {
      await api(`/companies/${id}`, { method: "DELETE" });
      navigate("/companies");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deletePerson(participantId: string) {
    if (
      !confirm(
        "Remove this person? This deletes them from every pilot in this project, along with their responses."
      )
    )
      return;
    try {
      await api(`/participants/${participantId}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error && !data) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!data) return <Layout><Spinner /></Layout>;

  return (
    <Layout>
      <Link to="/companies" className="muted" style={{ fontSize: 14 }}>
        ← All companies
      </Link>
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="spread" style={{ marginTop: 10 }}>
        <h1 style={{ margin: 0 }}>{data.company.name}</h1>
        <button className="btn-danger btn-sm" onClick={deleteCompany}>
          Delete company
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Admin: {data.company.adminEmail}{" "}
        <span className={`badge ${data.company.adminJoined ? "badge-accepted" : "badge-invited"}`}>
          {data.company.adminJoined ? "active" : "pending"}
        </span>
        <span style={{ marginLeft: 10 }}>
          · {data.participants.length} {data.participants.length === 1 ? "person" : "people"} across your pilots
        </span>
      </p>

      {data.participants.length === 0 ? (
        <div className="card empty">No participants from this company yet.</div>
      ) : (
        <div className="stack">
          {data.participants.map((p) => (
            <div key={p.id} className="card">
              <div className="spread">
                <div>
                  <h2 style={{ margin: 0 }}>{p.name ?? p.email}</h2>
                  {p.name && <div className="muted" style={{ fontSize: 13 }}>{p.email}</div>}
                </div>
                <div className="row">
                  <span className={`badge ${p.joined ? "badge-accepted" : "badge-invited"}`}>
                    {p.joined ? "joined" : "invited"}
                  </span>
                  <button className="btn-danger btn-sm" onClick={() => deletePerson(p.id)}>
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                {p.pilots.length === 0 ? (
                  <span className="muted">Not in any pilots.</span>
                ) : (
                  p.pilots.map((pl) => (
                    <div key={pl.pilotId} className="list-item">
                      <div className="row">
                        <Link to={`/pilots/${pl.pilotId}`}>{pl.pilotName}</Link>
                        <span className="muted" style={{ fontSize: 13 }}>· {pl.appName}</span>
                        <StatusBadge status={pl.status} />
                        {pl.membershipStatus === "INVITED" && (
                          <span className="badge badge-invited">not accepted</span>
                        )}
                      </div>
                      <span className="stat">
                        <b>{pl.entryCount}</b> {pl.entryCount === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
