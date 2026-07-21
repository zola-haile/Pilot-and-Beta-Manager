import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";

/* ============================ Applications list ============================ */

interface AppSummary {
  id: string;
  name: string;
  description: string | null;
  counts: { pilots: number };
  owner?: { id: string; name: string | null; email: string };
  mine?: boolean;
}

export function ApplicationsListPage() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const r = await api<{ applications: AppSummary[] }>("/applications");
      setApps(r.applications);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <Layout>
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1>Projects</h1>
          <p className="muted" style={{ margin: 0 }}>
            Each project is a product you're piloting. Open one to manage its pilots and companies.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "+ New project"}</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {showForm && (
        <NewAppForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!apps ? (
        <Spinner />
      ) : apps.length === 0 ? (
        <div className="card empty">
          No projects yet. Click <b>+ New project</b> to create your first one.
        </div>
      ) : (
        <div className="stack">
          {apps.map((a) => (
            <Link key={a.id} to={`/applications/${a.id}`} className="card card-link">
              <div className="spread" style={{ alignItems: "flex-start" }}>
                <h2 style={{ margin: 0 }}>{a.name}</h2>
                {a.owner && a.mine === false && (
                  <span className="badge badge-invited" title={a.owner.email}>
                    by {a.owner.name ?? a.owner.email}
                  </span>
                )}
              </div>
              {a.description && (
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {a.description}
                </p>
              )}
              <div className="stat-grid">
                <span className="stat">
                  <b>{a.counts.pilots}</b> {a.counts.pilots === 1 ? "pilot" : "pilots"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}

function NewAppForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/applications", { method: "POST", body: { name, description: description || null } });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 20 }} onSubmit={submit}>
      <h2>New project</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CheckoutApp" required />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}

/* =========================== Application detail =========================== */

interface Application {
  id: string;
  name: string;
  description: string | null;
}
interface PilotSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  counts: { questions: number; participants: number; submissions: number };
}

export function ApplicationDetailPage() {
  const { appId } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState<Application | null>(null);
  const [pilots, setPilots] = useState<PilotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const a = await api<{ application: Application }>(`/applications/${appId}`);
      setApp(a.application);
      const p = await api<{ pilots: PilotSummary[] }>(`/applications/${appId}/pilots`);
      setPilots(p.pilots);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [appId]);

  async function deleteApp() {
    if (
      !confirm(
        "Delete this project? This removes all of its pilots, companies, participants and responses. This cannot be undone."
      )
    )
      return;
    try {
      await api(`/applications/${appId}`, { method: "DELETE" });
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error && !app) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!app) return <Layout><Spinner /></Layout>;

  return (
    <Layout>
      <Link to="/" className="muted" style={{ fontSize: 14 }}>
        ← All projects
      </Link>

      {editing ? (
        <AppEditForm
          app={app}
          onDone={(updated) => {
            if (updated) setApp(updated);
            setEditing(false);
          }}
        />
      ) : (
        <div className="spread" style={{ marginTop: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Project
            </div>
            <h1 style={{ margin: "2px 0 0" }}>{app.name}</h1>
            {app.description && <p className="muted" style={{ margin: "6px 0 0" }}>{app.description}</p>}
          </div>
          <div className="row">
            <Link className="btn-ghost btn-sm" to={`/applications/${app.id}/feedback`}>
              Feedback
            </Link>
            <Link className="btn-ghost btn-sm" to={`/applications/${app.id}/analytics`}>
              Analytics
            </Link>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn-danger btn-sm" onClick={deleteApp}>
              Delete
            </button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="spread" style={{ margin: "28px 0 16px" }}>
        <h2 style={{ margin: 0 }}>Pilots</h2>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Close" : "+ New pilot"}</button>
      </div>

      {showForm && (
        <NewPilotForm
          appId={app.id}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {!pilots ? (
        <Spinner />
      ) : pilots.length === 0 ? (
        <div className="card empty">No pilots yet. Click <b>+ New pilot</b> to create one.</div>
      ) : (
        <div className="stack">
          {pilots.map((p) => (
            <Link key={p.id} to={`/pilots/${p.id}`} className="card card-link">
              <div className="spread">
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <StatusBadge status={p.status} />
              </div>
              {p.description && <p className="muted" style={{ margin: "8px 0 0" }}>{p.description}</p>}
              <div className="stat-grid">
                <span className="stat"><b>{p.counts.questions}</b> questions</span>
                <span className="stat"><b>{p.counts.participants}</b> participants</span>
                <span className="stat"><b>{p.counts.submissions}</b> responses</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <FeaturesSection appId={app.id} />
      </div>
      <div style={{ marginTop: 20 }}>
        <ThemesSection appId={app.id} />
      </div>
    </Layout>
  );
}

interface Theme {
  id: string;
  name: string;
  description: string | null;
  commentCount: number;
}

function ThemesSection({ appId }: { appId: string }) {
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api<{ themes: Theme[] }>(`/applications/${appId}/themes`);
      setThemes(r.themes);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [appId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/applications/${appId}/themes`, {
        method: "POST",
        body: { name, description: description || null },
      });
      setName("");
      setDescription("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this theme? Comments keep their content but are unlinked from it.")) return;
    await api(`/themes/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="card">
      <h2>Feedback themes</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Recurring insights you group comments under — across every pilot in this app. You can also
        create a theme on the fly while triaging a comment.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!themes ? (
        <Spinner />
      ) : themes.length === 0 ? (
        <p className="muted">No themes yet — group related feedback into one below.</p>
      ) : (
        <div>
          {themes.map((t) => (
            <div key={t.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <b>{t.name}</b>
                <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                  {t.commentCount} {t.commentCount === 1 ? "comment" : "comments"}
                </span>
                {t.description && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {t.description}
                  </div>
                )}
              </div>
              <button className="btn-danger btn-sm" onClick={() => remove(t.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} style={{ marginTop: 16 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Theme name (e.g. Checkout confusing on mobile)"
            required
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add theme"}
          </button>
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          style={{ marginTop: 8 }}
        />
      </form>
    </div>
  );
}

interface Feature {
  id: string;
  name: string;
  description: string | null;
  commentCount: number;
}

function FeaturesSection({ appId }: { appId: string }) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api<{ features: Feature[] }>(`/applications/${appId}/features`);
      setFeatures(r.features);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [appId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/applications/${appId}/features`, { method: "POST", body: { name } });
      setName("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this feature? It will be unlinked from any comments that reference it.")) return;
    await api(`/features/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="card">
      <h2>Features</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        The parts of this project participants can tag in their comments.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!features ? (
        <Spinner />
      ) : features.length === 0 ? (
        <p className="muted">No features yet — add some below.</p>
      ) : (
        <div>
          {features.map((f) => (
            <div key={f.id} className="list-item">
              <div>
                <b>{f.name}</b>
                <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                  {f.commentCount} {f.commentCount === 1 ? "comment" : "comments"}
                </span>
              </div>
              <button className="btn-danger btn-sm" onClick={() => remove(f.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="row" style={{ marginTop: 16, alignItems: "flex-start" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a feature (e.g. Checkout button)"
          required
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add feature"}
        </button>
      </form>
    </div>
  );
}

function AppEditForm({ app, onDone }: { app: Application; onDone: (updated: Application | null) => void }) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ application: Application }>(`/applications/${app.id}`, {
        method: "PATCH",
        body: { name, description: description || null },
      });
      onDone(r.application);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ marginTop: 10 }} onSubmit={save}>
      <label className="field">
        <span>Project name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

function NewPilotForm({ appId, onCreated }: { appId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appFeatures, setAppFeatures] = useState<Feature[]>([]);
  const [allFeatures, setAllFeatures] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ features: Feature[] }>(`/applications/${appId}/features`)
      .then((r) => setAppFeatures(r.features))
      .catch(() => {});
  }, [appId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/applications/${appId}/pilots`, {
        method: "POST",
        body: {
          name,
          description: description || null,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
          allFeatures,
          featureIds: allFeatures ? [] : [...selected],
        },
      });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 20 }} onSubmit={submit}>
      <h2>New pilot</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>End date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span>Features to pilot</span>
        <label className="inline-check" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={allFeatures} onChange={(e) => setAllFeatures(e.target.checked)} />
          <span>All features {appFeatures.length > 0 ? `(${appFeatures.length})` : ""}</span>
        </label>
        {!allFeatures &&
          (appFeatures.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No features yet — add some on the project page first.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {appFeatures.map((f) => (
                <label key={f.id} className="inline-check">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
          ))}
      </div>
      <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create pilot"}</button>
    </form>
  );
}
