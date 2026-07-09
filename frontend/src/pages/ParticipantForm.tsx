import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, assetUrl } from "../api";
import { useAuth } from "../auth";
import { Layout, Spinner, StatusBadge } from "../components";
import { categoryLabel } from "../categories";

interface Question {
  id: string;
  label: string;
  helpText: string | null;
  type: string;
  options: any;
  required: boolean;
}
interface PilotView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  questions: Question[];
}
type AnswerMap = Record<string, string>;
interface HistoryEntry {
  id: string;
  submittedAt: string;
  answers: AnswerMap;
}
interface FeatureRef {
  id: string;
  name: string;
}
interface CategoryOption {
  value: string;
  label: string;
}
interface LoadResponse {
  pilot: PilotView;
  features: FeatureRef[];
  commentCategories: CategoryOption[];
  draft: { answers: AnswerMap };
  history: HistoryEntry[];
}

export function ParticipantFormPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const homePath = user?.role === "COMPANY_ADMIN" ? "/piloting" : "/";
  const [pilot, setPilot] = useState<PilotView | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [features, setFeatures] = useState<FeatureRef[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<LoadResponse>(`/my/pilots/${id}`);
    setPilot(r.pilot);
    setAnswers(r.draft.answers ?? {});
    setHistory(r.history);
    setFeatures(r.features);
    setCategories(r.commentCategories);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  function setAnswer(qid: string, value: string) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  async function save(submit: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/my/pilots/${id}/submission`, {
        method: "PUT",
        body: { answers, submit },
      });
      if (submit) {
        // Finalized: clear the form for a fresh entry and refresh history.
        setAnswers({});
        await load();
        setNotice("Entry submitted. You can add another anytime.");
      } else {
        setNotice("Draft saved.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save(true);
  }

  async function deleteEntry(sid: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/my/pilots/${id}/submissions/${sid}`, { method: "DELETE" });
      await load();
      setNotice("Entry deleted.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error && !pilot) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!pilot) return <Layout><Spinner /></Layout>;

  return (
    <Layout>
      <Link to={homePath} className="muted" style={{ fontSize: 14 }}>
        ← Back to your pilots
      </Link>
      <div className="row" style={{ marginTop: 10 }}>
        <h1 style={{ margin: 0 }}>{pilot.name}</h1>
        <StatusBadge status={pilot.status} />
      </div>
      {pilot.description && <p className="muted">{pilot.description}</p>}

      {history.length > 0 && (
        <div className="alert alert-info">
          You've submitted {history.length} {history.length === 1 ? "entry" : "entries"} so far.
          Add another below — each submission is kept as its own dated entry.
        </div>
      )}
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" onSubmit={onSubmit}>
        <h2>{history.length > 0 ? "Add a new entry" : "Your response"}</h2>
        {pilot.questions.length === 0 ? (
          <p className="muted">The organizer hasn't added any questions yet.</p>
        ) : (
          pilot.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] ?? ""}
              onChange={(v) => setAnswer(q.id, v)}
            />
          ))
        )}
        {pilot.questions.length > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Submit entry"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(false)}>
              Save draft
            </button>
          </div>
        )}
      </form>

      {history.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Your previous entries</h2>
          <div className="stack">
            {history.map((h) => (
              <div key={h.id} className="card" style={{ boxShadow: "none", background: "#fafbfc" }}>
                <div className="spread" style={{ marginBottom: 10 }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {new Date(h.submittedAt).toLocaleString()}
                  </span>
                  <button className="btn-danger btn-sm" onClick={() => deleteEntry(h.id)}>
                    Delete
                  </button>
                </div>
                {pilot.questions.map((q) => (
                  <div key={q.id} style={{ marginBottom: 8 }}>
                    <div className="muted" style={{ fontSize: 13 }}>{q.label}</div>
                    <div>{formatAnswer(q, h.answers[q.id])}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <CommentsSection pilotId={id!} features={features} categories={categories} />
      </div>
    </Layout>
  );
}

interface CommentImage {
  id: string;
  url: string;
}
interface CommentItem {
  id: string;
  body: string;
  category: string;
  createdAt: string;
  features: FeatureRef[];
  images: CommentImage[];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function CommentsSection({
  pilotId,
  features,
  categories,
}: {
  pilotId: string;
  features: FeatureRef[];
  categories: CategoryOption[];
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("ENHANCEMENT");
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ comments: CommentItem[] }>(`/my/pilots/${pilotId}/comments`);
    setComments(r.comments);
  }
  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [pilotId]);

  function toggleFeature(id: string) {
    setFeatureIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
    setImages((prev) => [...prev, ...dataUrls].slice(0, 6));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/my/pilots/${pilotId}/comments`, {
        method: "POST",
        body: { body, category, featureIds, images },
      });
      setBody("");
      setCategory("ENHANCEMENT");
      setFeatureIds([]);
      setImages([]);
      setNotice("Comment posted.");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(cid: string) {
    if (!confirm("Delete this comment?")) return;
    await api(`/my/pilots/${pilotId}/comments/${cid}`, { method: "DELETE" });
    load();
  }

  const catOptions = categories.length > 0 ? categories : Object.keys({ ENHANCEMENT: 1 }).map((v) => ({ value: v, label: v }));

  return (
    <>
      <h2>Comments &amp; feedback</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Leave flexible feedback — pick a type, tag the features involved, and attach screenshots.
      </p>
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" onSubmit={submit} style={{ marginBottom: 20 }}>
        <label className="field">
          <span>Your feedback</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Describe what you noticed…" />
        </label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Type</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {catOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {features.length > 0 && (
          <label className="field">
            <span>Related features (optional)</span>
            <div className="chip-row">
              {features.map((f) => (
                <span
                  key={f.id}
                  className={`chip chip-select ${featureIds.includes(f.id) ? "on" : ""}`}
                  onClick={() => toggleFeature(f.id)}
                >
                  {f.name}
                </span>
              ))}
            </div>
          </label>
        )}
        <label className="field">
          <span>Attach images (optional, up to 6)</span>
          <input type="file" accept="image/*" multiple onChange={onPickImages} />
          {images.length > 0 && (
            <div className="thumb-row">
              {images.map((src, i) => (
                <div key={i} className="thumb">
                  <img src={src} alt="" />
                  <button
                    type="button"
                    className="remove"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Posting…" : "Post comment"}
        </button>
      </form>

      {comments.length > 0 && (
        <div className="stack">
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} onDelete={() => remove(c.id)} />
          ))}
        </div>
      )}
    </>
  );
}

export function CommentCard({
  comment,
  onDelete,
  author,
  company,
  headerExtra,
  footer,
}: {
  comment: CommentItem;
  onDelete?: () => void;
  author?: string | null;
  company?: string | null;
  headerExtra?: React.ReactNode; // extra badges next to the category (PM triage)
  footer?: React.ReactNode; // triage controls rendered below the body (PM only)
}) {
  return (
    <div className="card" style={{ boxShadow: "none", background: "#fafbfc" }}>
      <div className="spread">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="badge category-badge">{categoryLabel(comment.category)}</span>
          {headerExtra}
          {author && <b>{author}</b>}
          {company && <span className="badge badge-past">{company}</span>}
        </div>
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>
            {new Date(comment.createdAt).toLocaleString()}
          </span>
          {onDelete && (
            <button className="btn-danger btn-sm" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      <p style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{comment.body}</p>
      {comment.features.length > 0 && (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {comment.features.map((f) => (
            <span key={f.id} className="chip">
              {f.name}
            </span>
          ))}
        </div>
      )}
      {comment.images.length > 0 && (
        <div className="thumb-row">
          {comment.images.map((img) => (
            <div key={img.id} className="thumb">
              <a href={assetUrl(img.url)} target="_blank" rel="noreferrer">
                <img src={assetUrl(img.url)} alt="attachment" />
              </a>
            </div>
          ))}
        </div>
      )}
      {footer}
    </div>
  );
}

function formatAnswer(q: Question, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (q.type === "BOOLEAN") return value === "true" ? "Yes" : "No";
  if (q.type === "RATING") return `${value} / 5`;
  return value;
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  const req = question.required;
  return (
    <label className="field">
      <span>
        {question.label} {req && <span style={{ color: "var(--danger)" }}>*</span>}
      </span>
      {question.helpText && (
        <small className="muted" style={{ display: "block", marginBottom: 6 }}>
          {question.helpText}
        </small>
      )}
      <QuestionInput question={question} value={value} onChange={onChange} />
    </label>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  switch (question.type) {
    case "TEXTAREA":
      return <textarea value={value} onChange={(e) => onChange(e.target.value)} required={question.required} />;
    case "NUMBER":
      return (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} required={question.required} />
      );
    case "BOOLEAN":
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)} required={question.required}>
          <option value="">Select…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case "SELECT": {
      const choices: string[] = question.options?.choices ?? [];
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)} required={question.required}>
          <option value="">Select…</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    }
    case "RATING": {
      const max = question.options?.max ?? 5;
      return (
        <div className="row">
          {Array.from({ length: max }, (_, i) => String(i + 1)).map((n) => (
            <button
              type="button"
              key={n}
              className={value === n ? "" : "btn-ghost"}
              onClick={() => onChange(n)}
              style={{ minWidth: 44 }}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }
    default:
      return <input value={value} onChange={(e) => onChange(e.target.value)} required={question.required} />;
  }
}
