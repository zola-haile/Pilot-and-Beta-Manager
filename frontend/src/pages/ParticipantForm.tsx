import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, assetUrl } from "../api";
import { useAuth } from "../auth";
import { Layout, Spinner, StatusBadge } from "../components";
import { categoryLabel } from "../categories";
import { ChatPanel } from "./Chat";

interface Question {
  id: string;
  label: string;
  helpText: string | null;
  type: string;
  options: any;
  required: boolean;
  featureId: string | null;
}
interface PilotView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
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
// Features as returned by the pilot load — carry this user's rating and the shared
// average. (Assignable to FeatureRef anywhere only id+name are needed.)
interface RatableFeature extends FeatureRef {
  description: string | null;
  myRating: number | null;
  avgRating: number | null;
  ratingCount: number;
}
interface CategoryOption {
  value: string;
  label: string;
}
interface LoadResponse {
  pilot: PilotView;
  features: RatableFeature[];
  commentCategories: CategoryOption[];
  draft: { answers: AnswerMap };
  history: HistoryEntry[];
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

// The three feedback lanes surfaced as cards. Each locks the comment category so
// the participant never has to reason about our taxonomy — they just pick intent.
type ActionKind = "issue" | "idea" | "praise";
interface ActionSpec {
  kind: ActionKind;
  category: string;
  icon: string;
  title: string;
  sub: string;
  heading: string;
  placeholder: string;
  cta: string;
  past: string; // plural noun for the "your previous ___" heading
}
const ACTIONS: ActionSpec[] = [
  {
    kind: "issue",
    category: "BUG",
    icon: "🐞",
    title: "Report an issue",
    sub: "Something broken, confusing, or slow",
    heading: "Report an issue",
    placeholder: "What went wrong? Steps to reproduce it, and what you expected instead…",
    cta: "Submit issue",
    past: "issues",
  },
  {
    kind: "idea",
    category: "FEATURE_REQUEST",
    icon: "💡",
    title: "Share an idea",
    sub: "Suggest a feature or improvement",
    heading: "Share an idea",
    placeholder: "What would you like to see? What problem would it solve for you?",
    cta: "Submit idea",
    past: "ideas",
  },
  {
    kind: "praise",
    category: "PRAISE",
    icon: "🎉",
    title: "Give praise",
    sub: "Tell us what's working well",
    heading: "Give praise",
    placeholder: "What did you love? What's working better than before?",
    cta: "Submit praise",
    past: "praise",
  },
];

export function ParticipantFormPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const homePath = user?.role === "COMPANY_ADMIN" ? "/piloting" : "/";
  const [pilot, setPilot] = useState<PilotView | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [features, setFeatures] = useState<RatableFeature[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Top-level section. Survey only appears when the pilot has questions.
  const [tab, setTab] = useState<"feedback" | "overview" | "survey" | "chat">("feedback");
  // Within the Feedback tab, which report card is expanded (null = just the cards).
  const [active, setActive] = useState<ActionKind | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const [r, c] = await Promise.all([
      api<LoadResponse>(`/my/pilots/${id}`),
      api<{ comments: CommentItem[] }>(`/my/pilots/${id}/comments`),
    ]);
    setPilot(r.pilot);
    setAnswers(r.draft.answers ?? {});
    setHistory(r.history);
    setFeatures(r.features);
    setComments(c.comments);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  function openLane(lane: ActionKind) {
    setError(null);
    setNotice(null);
    setActive(lane);
    // Let the panel render, then bring it into view.
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

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
        setActive(null);
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

  async function deleteComment(cid: string) {
    if (!confirm("Delete this feedback?")) return;
    await api(`/my/pilots/${id}/comments/${cid}`, { method: "DELETE" });
    await load();
  }

  async function shareToChat(commentId: string, anonymous: boolean) {
    setError(null);
    setNotice(null);
    try {
      await api(`/my/pilots/${id}/chat`, { method: "POST", body: { commentId, anonymous } });
      setTab("chat");
      setNotice("Shared to the pilot chat.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function rateFeature(featureId: string, stars: number) {
    setError(null);
    try {
      const r = await api<{ myRating: number; avgRating: number | null; ratingCount: number }>(
        `/my/pilots/${id}/features/${featureId}/rating`,
        { method: "PUT", body: { stars } }
      );
      setFeatures((prev) =>
        prev.map((f) =>
          f.id === featureId
            ? { ...f, myRating: r.myRating, avgRating: r.avgRating, ratingCount: r.ratingCount }
            : f
        )
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error && !pilot) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!pilot) return <Layout><Spinner /></Layout>;

  const activeAction = ACTIONS.find((a) => a.kind === active) ?? null;
  const hasQuestions = pilot.questions.length > 0;

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

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="tabbar" style={{ marginTop: 20 }}>
        {([
          { key: "feedback", label: "Give feedback", count: comments.length },
          { key: "overview", label: "Overview" },
          ...(hasQuestions ? [{ key: "survey" as const, label: "Survey", count: history.length }] : []),
          { key: "chat", label: "Chat" },
        ] as { key: typeof tab; label: string; count?: number }[]).map((t) => (
          <button
            key={t.key}
            className={`tabbtn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count ? <span className="tabbtn__count">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        {tab === "overview" && (
          <>
            <ProgressGraph startDate={pilot.startDate} endDate={pilot.endDate} />
            <FeatureRatings features={features} onRate={rateFeature} />
          </>
        )}

        {tab === "feedback" && (
          <>
            <h2 style={{ marginTop: 0 }}>What would you like to do?</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Pick a card to submit feedback — the number shows how many you've already sent. Open a
              card to review your past submissions.
            </p>
            <div className="action-grid">
              {ACTIONS.map((a) => {
                const count = comments.filter((c) => c.category === a.category).length;
                return (
                  <button
                    key={a.kind}
                    type="button"
                    className={`action-card tone-${a.kind} ${active === a.kind ? "active" : ""}`}
                    onClick={() => (active === a.kind ? setActive(null) : openLane(a.kind))}
                  >
                    {count > 0 && <span className="action-card__badge">{count}</span>}
                    <span className="action-card__icon">{a.icon}</span>
                    <span className="action-card__title">{a.title}</span>
                    <span className="action-card__sub">{a.sub}</span>
                  </button>
                );
              })}
            </div>

            <div ref={composerRef}>
              {activeAction && (
                <>
                  <FeedbackComposer
                    key={activeAction.kind}
                    pilotId={id!}
                    spec={activeAction}
                    features={features}
                    onCancel={() => setActive(null)}
                    onPosted={async () => {
                      await load();
                      setNotice(`Thanks — your ${activeAction.past === "praise" ? "praise" : activeAction.past.replace(/s$/, "")} was submitted.`);
                    }}
                  />
                  <PastSubmissions
                    heading={`Your previous ${activeAction.past}`}
                    comments={comments.filter((c) => c.category === activeAction.category)}
                    onDelete={deleteComment}
                    onShareToChat={shareToChat}
                  />
                </>
              )}
            </div>
          </>
        )}

        {tab === "survey" && hasQuestions && (
          <>
            <form className="card composer tone-survey" onSubmit={onSubmit}>
              <h2 style={{ margin: 0 }}>
                <span style={{ marginRight: 8 }}>📋</span>
                {history.length > 0 ? "Add a new entry" : "Answer the survey"}
              </h2>
              {history.length > 0 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  Each submission is kept as its own dated entry — add another anytime.
                </p>
              )}
              {groupQuestions(pilot.questions, features).map((g) => (
                <div key={g.key} style={{ marginBottom: 8 }}>
                  {g.title && <div className="feature-heading">🧩 {g.title}</div>}
                  {g.items.map((q) => (
                    <QuestionField
                      key={q.id}
                      question={q}
                      value={answers[q.id] ?? ""}
                      onChange={(v) => setAnswer(q.id, v)}
                    />
                  ))}
                </div>
              ))}
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Submit entry"}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(false)}>
                  Save draft
                </button>
              </div>
            </form>

            {history.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3>Your previous entries</h3>
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
          </>
        )}

        {tab === "chat" && <ParticipantChat pilotId={id!} />}
      </div>
    </Layout>
  );
}

// The Chat tab for participants: the public group channel, or a private line to
// the organizer.
function ParticipantChat({ pilotId }: { pilotId: string }) {
  const [view, setView] = useState<"group" | "private">("group");
  return (
    <>
      <div className="tabbar">
        <button className={`tabbtn ${view === "group" ? "active" : ""}`} onClick={() => setView("group")}>
          Group chat
        </button>
        <button className={`tabbtn ${view === "private" ? "active" : ""}`} onClick={() => setView("private")}>
          Message the organizer
        </button>
      </div>
      {view === "group" ? (
        <ChatPanel basePath={`/my/pilots/${pilotId}/chat`} />
      ) : (
        <ChatPanel
          basePath={`/my/pilots/${pilotId}/chat/private`}
          heading="Private message to the organizer"
          blurb="A direct line to the PM. Only you and the organizer can see this."
          emptyText="No messages yet. Send the organizer a private note."
          allowAnonymous={false}
        />
      )}
    </>
  );
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// A horizontal timeline showing how far the pilot has run and how long is left.
function ProgressGraph({ startDate, endDate }: { startDate: string | null; endDate: string | null }) {
  const now = Date.now();
  const start = startDate ? new Date(startDate).getTime() : null;
  const end = endDate ? new Date(endDate).getTime() : null;
  const dayMs = 86_400_000;

  if (!end) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Pilot timeline</h2>
        <p className="muted" style={{ margin: 0 }}>No end date has been set for this pilot yet.</p>
      </div>
    );
  }

  const notStarted = start !== null && now < start;
  const ended = now >= end;
  const base = start ?? Math.min(now, end);
  const total = end - base;
  const pct = ended ? 100 : total > 0 ? Math.min(100, Math.max(0, ((now - base) / total) * 100)) : 0;

  let headline: string;
  if (ended) {
    headline = "Pilot ended";
  } else if (notStarted) {
    const d = Math.ceil((start! - now) / dayMs);
    headline = `Starts in ${d} ${d === 1 ? "day" : "days"}`;
  } else {
    const d = Math.ceil((end - now) / dayMs);
    headline = `${d} ${d === 1 ? "day" : "days"} left`;
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Pilot timeline</h2>
        <span className={`badge ${ended ? "badge-past" : notStarted ? "badge-upcoming" : "badge-active"}`}>
          {headline}
        </span>
      </div>
      <div className="progress-track" style={{ marginTop: 14 }}>
        <div className={`progress-fill ${ended ? "is-ended" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="spread progress-ends">
        <span>{start ? fmtDate(start) : "No start date"}</span>
        <span>{fmtDate(end)}</span>
      </div>
    </div>
  );
}

// The pilot's features, each ratable 1–5 stars. Shows the user's own rating plus
// the shared average across everyone in the pilot.
function FeatureRatings({
  features,
  onRate,
}: {
  features: RatableFeature[];
  onRate: (featureId: string, stars: number) => void;
}) {
  if (features.length === 0) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <h2>Rate the features</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        How's each part working for you? Tap the stars — you can change your rating anytime.
      </p>
      <div className="stack">
        {features.map((f) => (
          <div key={f.id} className="card feature-rate">
            <div className="spread">
              <div>
                <b>{f.name}</b>
                {f.description && (
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{f.description}</p>
                )}
              </div>
              <div className="feature-rate__stars">
                <StarRating value={f.myRating} onChange={(v) => onRate(f.id, v)} />
                <span className="muted feature-rate__avg">
                  {f.ratingCount > 0
                    ? `${f.avgRating!.toFixed(1)} avg · ${f.ratingCount} ${f.ratingCount === 1 ? "rating" : "ratings"}`
                    : "No ratings yet"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          className={`star ${n <= shown ? "on" : ""}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// A category-locked composer. The card the participant clicked already decided the
// intent, so there's no type picker here — just their words, features, and images.
function FeedbackComposer({
  pilotId,
  spec,
  features,
  onPosted,
  onCancel,
}: {
  pilotId: string;
  spec: ActionSpec;
  features: FeatureRef[];
  onPosted: () => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleFeature(fid: string) {
    setFeatureIds((prev) => (prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]));
  }

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
    setImages((prev) => [...prev, ...dataUrls].slice(0, 6));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/my/pilots/${pilotId}/comments`, {
        method: "POST",
        body: { body, category: spec.category, featureIds, images },
      });
      onPosted();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className={`card composer tone-${spec.kind}`} onSubmit={submit} style={{ marginTop: 16 }}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>
          <span style={{ marginRight: 8 }}>{spec.icon}</span>
          {spec.heading}
        </h2>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      <label className="field" style={{ marginTop: 10 }}>
        <span>Your feedback</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} required placeholder={spec.placeholder} />
      </label>
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
      <button type="submit" disabled={busy || !body.trim()}>
        {busy ? "Submitting…" : spec.cta}
      </button>
    </form>
  );
}

// The list of a participant's own past submissions in one category, shown inside
// that category's open card.
function PastSubmissions({
  heading,
  comments,
  onDelete,
  onShareToChat,
}: {
  heading: string;
  comments: CommentItem[];
  onDelete: (cid: string) => void;
  onShareToChat: (cid: string, anonymous: boolean) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>{heading}</h3>
      {comments.length === 0 ? (
        <p className="muted">Nothing here yet — your submissions will show up in this list.</p>
      ) : (
        <div className="stack">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              onDelete={() => onDelete(c.id)}
              onShareToChat={(anon) => onShareToChat(c.id, anon)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// General questions first, then a section per feature (in the pilot's order).
function groupQuestions(
  questions: Question[],
  features: FeatureRef[]
): { key: string; title: string | null; items: Question[] }[] {
  const groups: { key: string; title: string | null; items: Question[] }[] = [];
  const general = questions.filter((q) => !q.featureId);
  if (general.length) groups.push({ key: "__general__", title: null, items: general });
  for (const f of features) {
    const items = questions.filter((q) => q.featureId === f.id);
    if (items.length) groups.push({ key: f.id, title: f.name, items });
  }
  // Any question whose feature isn't in the piloted list falls back to a group.
  const known = new Set(features.map((f) => f.id));
  const orphan = questions.filter((q) => q.featureId && !known.has(q.featureId));
  if (orphan.length) groups.push({ key: "__orphan__", title: null, items: orphan });
  return groups;
}

export function CommentCard({
  comment,
  onDelete,
  onShareToChat,
  author,
  company,
  headerExtra,
  footer,
}: {
  comment: CommentItem;
  onDelete?: () => void;
  onShareToChat?: (anonymous: boolean) => void; // participant: share this report to chat
  author?: string | null;
  company?: string | null;
  headerExtra?: React.ReactNode; // extra badges next to the category (PM triage)
  footer?: React.ReactNode; // triage controls rendered below the body (PM only)
}) {
  const [sharing, setSharing] = useState(false);
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
      {onShareToChat &&
        (sharing ? (
          <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Share to chat as…</span>
            <button className="btn-ghost btn-sm" onClick={() => onShareToChat(false)}>
              My name
            </button>
            <button className="btn-ghost btn-sm" onClick={() => onShareToChat(true)}>
              Anonymous
            </button>
            <button className="linkish" onClick={() => setSharing(false)}>Cancel</button>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <button className="btn-ghost btn-sm" onClick={() => setSharing(true)}>
              📣 Report to public chat
            </button>
          </div>
        ))}
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
