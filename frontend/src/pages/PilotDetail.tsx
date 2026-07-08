import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";
import { CommentCard } from "./ParticipantForm";

const QUESTION_TYPES = [
  { value: "TEXT", label: "Short text" },
  { value: "TEXTAREA", label: "Long text" },
  { value: "NUMBER", label: "Number" },
  { value: "BOOLEAN", label: "Yes / No" },
  { value: "SELECT", label: "Multiple choice" },
  { value: "RATING", label: "Rating (1–5)" },
];

interface Question {
  id: string;
  label: string;
  helpText: string | null;
  type: string;
  options: any;
  required: boolean;
  order: number;
}
interface Participant {
  id: string;
  email: string;
  name: string | null;
  company: { id: string; name: string };
  status: string;
  invitedAt: string;
  acceptedAt: string | null;
  joined: boolean;
  inviteUrl: string;
  entryCount: number;
}
interface Company {
  id: string;
  name: string;
  participantCount: number;
}
interface PilotCompanyRow {
  id: string;
  company: { id: string; name: string };
  adminEmail: string;
  adminJoined: boolean;
  participantsInPilot: number;
  shareUrl: string;
}
interface PilotDetail {
  id: string;
  applicationId: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  questions: Question[];
  companies: PilotCompanyRow[];
  participants: Participant[];
}
interface ResponseRow {
  id: string;
  user: { id: string; name: string | null; email: string };
  company: string | null;
  participantName: string | null;
  submittedAt: string;
  answers: Record<string, string | null>;
}

export function PilotDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pilot, setPilot] = useState<PilotDetail | null>(null);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ pilot: PilotDetail }>(`/pilots/${id}`);
      setPilot(res.pilot);
      const r = await api<{ responses: ResponseRow[] }>(`/pilots/${id}/responses`);
      setResponses(r.responses);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function deletePilot() {
    if (!confirm("Delete this pilot and all its data? This cannot be undone.")) return;
    try {
      const appId = pilot?.applicationId;
      await api(`/pilots/${id}`, { method: "DELETE" });
      navigate(appId ? `/applications/${appId}` : "/");
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!pilot) return <Layout><Spinner /></Layout>;

  return (
    <Layout>
      <Link to={`/applications/${pilot.applicationId}`} className="muted" style={{ fontSize: 14 }}>
        ← Back to application
      </Link>
      <div className="spread" style={{ marginTop: 10, marginBottom: 6 }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>{pilot.name}</h1>
          <StatusBadge status={pilot.status} />
        </div>
        <button className="btn-danger btn-sm" onClick={deletePilot}>
          Delete pilot
        </button>
      </div>
      {pilot.description && <p className="muted">{pilot.description}</p>}
      <p className="muted" style={{ marginTop: 0 }}>
        {formatRange(pilot.startDate, pilot.endDate)}
      </p>

      <div className="stack" style={{ marginTop: 24 }}>
        <QuestionsSection pilotId={pilot.id} questions={pilot.questions} onChange={load} />
        <CompaniesInPilotSection pilotId={pilot.id} companies={pilot.companies} onChange={load} />
        <ParticipantsSection pilotId={pilot.id} participants={pilot.participants} onChange={load} />
        <ResponsesSection pilotId={pilot.id} questions={pilot.questions} responses={responses} onChange={load} />
        <PilotCommentsSection pilotId={pilot.id} />
      </div>
    </Layout>
  );
}

function formatRange(start: string | null, end: string | null): string {
  const f = (s: string) => new Date(s).toLocaleDateString();
  if (start && end) return `${f(start)} → ${f(end)}`;
  if (start) return `Starts ${f(start)}`;
  if (end) return `Ends ${f(end)}`;
  return "No dates set (draft)";
}

/* ------------------------------ Questions ------------------------------ */

function QuestionsSection({
  pilotId,
  questions,
  onChange,
}: {
  pilotId: string;
  questions: Question[];
  onChange: () => void;
}) {
  const [label, setLabel] = useState("");
  const [helpText, setHelpText] = useState("");
  const [type, setType] = useState("TEXT");
  const [required, setRequired] = useState(false);
  const [choices, setChoices] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const options =
        type === "SELECT"
          ? { choices: choices.split(",").map((c) => c.trim()).filter(Boolean) }
          : type === "RATING"
          ? { min: 1, max: 5 }
          : undefined;
      await api(`/pilots/${pilotId}/questions`, {
        method: "POST",
        body: { label, helpText: helpText || null, type, required, options },
      });
      setLabel("");
      setHelpText("");
      setChoices("");
      setRequired(false);
      setType("TEXT");
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(qid: string) {
    if (!confirm("Delete this question?")) return;
    await api(`/pilots/${pilotId}/questions/${qid}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <h2>Questions & fields</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        These are what participants see and fill in.
      </p>
      {questions.length === 0 ? (
        <p className="muted">No questions yet — add one below.</p>
      ) : (
        <div>
          {questions.map((q) => (
            <div key={q.id} className="list-item">
              <div>
                <b>{q.label}</b>{" "}
                {q.required && <span style={{ color: "var(--danger)" }}>*</span>}
                <div className="muted" style={{ fontSize: 13 }}>
                  {typeLabel(q.type)}
                  {q.helpText ? ` · ${q.helpText}` : ""}
                  {q.type === "SELECT" && q.options?.choices
                    ? ` · ${q.options.choices.join(", ")}`
                    : ""}
                </div>
              </div>
              <button className="btn-danger btn-sm" onClick={() => remove(q.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <label className="field">
          <span>Question / field label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="e.g. How likely are you to recommend this?" />
        </label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {QUESTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 2 }}>
            <span>Help text (optional)</span>
            <input value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </label>
        </div>
        {type === "SELECT" && (
          <label className="field">
            <span>Choices (comma-separated)</span>
            <input value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="Yes, No, Maybe" />
          </label>
        )}
        <label className="inline-check" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>Required</span>
        </label>
        <div>
          <button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add question"}
          </button>
        </div>
      </form>
    </div>
  );
}

function typeLabel(type: string): string {
  return QUESTION_TYPES.find((t) => t.value === type)?.label ?? type;
}

/* -------------------------- Companies in pilot -------------------------- */

function CompaniesInPilotSection({
  pilotId,
  companies,
  onChange,
}: {
  pilotId: string;
  companies: PilotCompanyRow[];
  onChange: () => void;
}) {
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    const r = await api<{ companies: Company[] }>("/companies");
    setAllCompanies(r.companies);
  }
  useEffect(() => {
    loadAll();
  }, []);

  const inPilot = new Set(companies.map((c) => c.company.id));
  const available = allCompanies.filter((c) => !inPilot.has(c.id));

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/pilots/${pilotId}/companies`, { method: "POST", body: { companyId: selected } });
      setNotice("Company added — its admin has been emailed.");
      setSelected("");
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(pcId: string) {
    if (!confirm("Remove this company from the pilot?")) return;
    await api(`/pilots/${pilotId}/companies/${pcId}`, { method: "DELETE" });
    onChange();
  }

  async function resend(pcId: string) {
    await api(`/pilots/${pilotId}/companies/${pcId}/resend`, { method: "POST" });
    setNotice("Admin re-emailed.");
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setNotice("Share link copied to clipboard.");
  }

  return (
    <div className="card">
      <h2>Companies in this pilot</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Adding a company emails its admin, who can then invite their own people.
      </p>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {companies.length === 0 ? (
        <p className="muted">No companies added yet.</p>
      ) : (
        <div>
          {companies.map((c) => (
            <div key={c.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <div className="row">
                  <Link to={`/companies/${c.company.id}`} style={{ fontWeight: 700 }}>
                    🏢 {c.company.name}
                  </Link>
                  <span className={`badge ${c.adminJoined ? "badge-accepted" : "badge-invited"}`}>
                    admin {c.adminJoined ? "active" : "pending"}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {c.participantsInPilot} in pilot
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{c.adminEmail}</div>
              </div>
              <div className="row">
                <button className="btn-ghost btn-sm" onClick={() => copy(c.shareUrl)}>
                  Share link
                </button>
                <button className="btn-ghost btn-sm" onClick={() => resend(c.id)}>
                  Re-email admin
                </button>
                <button className="btn-danger btn-sm" onClick={() => remove(c.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="row" style={{ marginTop: 18, alignItems: "flex-start" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ flex: 1 }}>
          <option value="">Add an existing company…</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !selected}>
          {busy ? "Adding…" : "Add to pilot"}
        </button>
      </form>
      {available.length === 0 && allCompanies.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          All your companies are already in this pilot. Create more on the Companies page.
        </p>
      )}
    </div>
  );
}

/* ----------------------------- Participants ----------------------------- */

function ParticipantsSection({
  pilotId,
  participants,
  onChange,
}: {
  pilotId: string;
  participants: Participant[];
  onChange: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState<string>("__new__");
  const [companyName, setCompanyName] = useState("");
  const [companyAdminEmail, setCompanyAdminEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadCompanies() {
    const r = await api<{ companies: Company[] }>("/companies");
    setCompanies(r.companies);
    // Default the picker to the first existing company, if any.
    if (r.companies.length > 0 && companyId === "__new__" && !companyName) {
      setCompanyId(r.companies[0].id);
    }
  }
  useEffect(() => {
    loadCompanies();
  }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { email, name: name || null };
      if (companyId === "__new__") {
        body.companyName = companyName;
        body.companyAdminEmail = companyAdminEmail;
      } else {
        body.companyId = companyId;
      }
      await api(`/pilots/${pilotId}/invitations`, { method: "POST", body });
      setNotice(`Invitation sent to ${email}.`);
      setEmail("");
      setName("");
      setCompanyName("");
      setCompanyAdminEmail("");
      onChange();
      loadCompanies();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(mid: string) {
    if (!confirm("Remove this participant from the pilot?")) return;
    await api(`/pilots/${pilotId}/invitations/${mid}`, { method: "DELETE" });
    onChange();
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setNotice("Invite link copied to clipboard.");
  }

  // Group participants by company for display.
  const groups = new Map<string, { name: string; people: Participant[] }>();
  for (const p of participants) {
    const g = groups.get(p.company.id) ?? { name: p.company.name, people: [] };
    g.people.push(p);
    groups.set(p.company.id, g);
  }

  return (
    <div className="card">
      <h2>Participants</h2>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {participants.length === 0 ? (
        <p className="muted">No participants invited yet.</p>
      ) : (
        <div className="stack" style={{ gap: 20 }}>
          {[...groups.entries()].map(([cid, g]) => (
            <div key={cid}>
              <div className="row" style={{ marginBottom: 4 }}>
                <Link to={`/companies/${cid}`} style={{ fontWeight: 700 }}>
                  🏢 {g.name}
                </Link>
                <span className="muted" style={{ fontSize: 13 }}>
                  {g.people.length} {g.people.length === 1 ? "person" : "people"}
                </span>
              </div>
              {g.people.map((p) => (
                <div key={p.id} className="list-item">
                  <div style={{ minWidth: 0 }}>
                    <div className="row">
                      <b>{p.name ?? p.email}</b>
                      <span className={`badge badge-${p.status.toLowerCase()}`}>
                        {p.status.toLowerCase()}
                      </span>
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
                      <button className="btn-ghost btn-sm" onClick={() => copyLink(p.inviteUrl)}>
                        Copy link
                      </button>
                    )}
                    <button className="btn-danger btn-sm" onClick={() => revoke(p.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={invite}
        style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 18 }}
      >
        <h3 style={{ marginBottom: 10 }}>Invite someone</h3>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="participant@email.com"
              required
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Company</span>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new__">+ New company…</option>
            </select>
          </label>
          {companyId === "__new__" && (
            <label className="field" style={{ flex: 1 }}>
              <span>New company name</span>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. CP Inc."
                required
              />
            </label>
          )}
        </div>
        {companyId === "__new__" && (
          <label className="field">
            <span>New company's admin email</span>
            <input
              type="email"
              value={companyAdminEmail}
              onChange={(e) => setCompanyAdminEmail(e.target.value)}
              placeholder="admin@company.com"
              required
            />
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------ Responses ------------------------------ */

function ResponsesSection({
  pilotId,
  questions,
  responses,
  onChange,
}: {
  pilotId: string;
  questions: Question[];
  responses: ResponseRow[];
  onChange: () => void;
}) {
  async function remove(sid: string) {
    if (!confirm("Delete this response? This cannot be undone.")) return;
    await api(`/pilots/${pilotId}/responses/${sid}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <h2>Responses ({responses.length})</h2>
      {responses.length === 0 ? (
        <p className="muted">No submitted responses yet.</p>
      ) : (
        <div className="stack">
          {responses.map((r) => (
            <div key={r.id} className="card" style={{ boxShadow: "none", background: "#fafbfc" }}>
              <div className="spread">
                <div className="row">
                  <b>{r.participantName ?? r.user.name ?? r.user.email}</b>
                  {r.company && <span className="badge badge-past">{r.company}</span>}
                </div>
                <div className="row">
                  <span className="muted" style={{ fontSize: 13 }}>
                    {new Date(r.submittedAt).toLocaleString()}
                  </span>
                  <button className="btn-danger btn-sm" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {questions.map((q) => (
                  <div key={q.id} style={{ marginBottom: 8 }}>
                    <div className="muted" style={{ fontSize: 13 }}>{q.label}</div>
                    <div>{formatAnswer(q, r.answers[q.id])}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAnswer(q: Question, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (q.type === "BOOLEAN") return value === "true" ? "Yes" : "No";
  if (q.type === "RATING") return `${value} / 5`;
  return value;
}

interface PMComment {
  id: string;
  body: string;
  category: string;
  createdAt: string;
  author: { name: string | null; email: string };
  company: string | null;
  features: { id: string; name: string }[];
  images: { id: string; url: string }[];
}

function PilotCommentsSection({ pilotId }: { pilotId: string }) {
  const [comments, setComments] = useState<PMComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api<{ comments: PMComment[] }>(`/pilots/${pilotId}/comments`);
      setComments(r.comments);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [pilotId]);

  async function remove(cid: string) {
    if (!confirm("Delete this comment?")) return;
    await api(`/pilots/${pilotId}/comments/${cid}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="card">
      <h2>Comments &amp; feedback ({comments?.length ?? 0})</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {!comments ? (
        <Spinner />
      ) : comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <div className="stack">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              author={c.author.name ?? c.author.email}
              company={c.company}
              onDelete={() => remove(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
