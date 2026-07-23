import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Layout, Spinner, StatusBadge } from "../components";
import { categoryLabel } from "../categories";
import { ChatPanel } from "./Chat";
import { useImageAttach, AttachmentPreviews, AttachmentList, DropOverlay, AttachmentRef } from "../ImageAttach";

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
  surveyEnabled: boolean;
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
interface Announcement {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  images: AttachmentRef[];
}
interface LoadResponse {
  pilot: PilotView;
  features: RatableFeature[];
  commentCategories: CategoryOption[];
  announcements: Announcement[];
  draft: { answers: AnswerMap };
  history: HistoryEntry[];
}

export interface Reply {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null; // null = anonymous
  isOrganizer: boolean;
  mine: boolean;
}
interface SimilarReport {
  id: string;
  subject: string | null;
  category: string;
  snippet: string;
  replyCount: number;
  createdAt: string;
}
interface CommentItem {
  id: string;
  subject?: string | null;
  body: string;
  category: string;
  createdAt: string;
  features: FeatureRef[];
  images: AttachmentRef[];
  anonymous?: boolean;
  authorName?: string | null; // null = anonymous (public board)
  company?: string | null;
  mine?: boolean;
  replies?: Reply[];
}

// The three feedback lanes surfaced as cards. Each locks the comment category so
// the participant never has to reason about our taxonomy — they just pick intent.
type ActionKind = "issue" | "idea" | "praise";
interface ActionSpec {
  kind: ActionKind;
  category: string;
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
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Top-level section. Survey only appears when the pilot has questions.
  const [tab, setTab] = useState<"feedback" | "overview" | "survey" | "ask">("feedback");
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
    setAnnouncements(r.announcements ?? []);
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
    if (!confirm("Delete this report?")) return;
    await api(`/my/pilots/${id}/comments/${cid}`, { method: "DELETE" });
    await load();
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
  const hasQuestions = pilot.surveyEnabled && pilot.questions.length > 0;

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
          { key: "feedback", label: "Reports", count: comments.length },
          { key: "overview", label: "Overview" },
          ...(hasQuestions ? [{ key: "survey" as const, label: "Survey", count: history.length }] : []),
          { key: "ask", label: "Ask a question" },
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
            <AnnouncementsFeed items={announcements} />
            <ProgressGraph startDate={pilot.startDate} endDate={pilot.endDate} />
            <FeatureRatings features={features} onRate={rateFeature} />
          </>
        )}

        {tab === "feedback" && (
          <>
            <h2 style={{ marginTop: 0 }}>What would you like to do?</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Reports are shared with everyone in this pilot — the number shows how many are posted in
              each lane. Open a lane to post one or join the discussion.
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
                    <span className="action-card__dot" aria-hidden="true" />
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
                    allComments={comments}
                    onCancel={() => setActive(null)}
                    onPosted={async () => {
                      await load();
                      setNotice(`Thanks — your ${activeAction.past === "praise" ? "praise" : activeAction.past.replace(/s$/, "")} was posted.`);
                    }}
                    onReplied={async () => {
                      await load();
                      setNotice("Your reply was posted to the existing report.");
                    }}
                  />
                  <ReportBoard
                    heading={`All ${activeAction.past} in this pilot`}
                    pilotId={id!}
                    comments={comments.filter((c) => c.category === activeAction.category)}
                    onDelete={deleteComment}
                    onChanged={load}
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
                {history.length > 0 ? "Add a new entry" : "Answer the survey"}
              </h2>
              {history.length > 0 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  Each submission is kept as its own dated entry — add another anytime.
                </p>
              )}
              {groupQuestions(pilot.questions, features).map((g) => (
                <div key={g.key} style={{ marginBottom: 8 }}>
                  {g.title && <div className="feature-heading">{g.title}</div>}
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

        {tab === "ask" && (
          <ChatPanel
            basePath={`/my/pilots/${id}/chat/private`}
            heading="Ask a question"
            blurb="A private line to the organizer. Only you and the PM can see this — it's not shared with other participants."
            emptyText="No messages yet. Ask the organizer anything about the pilot."
          />
        )}
      </div>
    </Layout>
  );
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// A horizontal timeline showing how far the pilot has run and how long is left.
// Organizer announcements, newest first. Shown at the top of the overview.
function AnnouncementsFeed({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card" style={{ borderLeft: "3px solid var(--primary)" }}>
      <h3 style={{ marginTop: 0 }}>📣 Announcements</h3>
      <div className="stack">
        {items.map((a) => (
          <div key={a.id} className="card" style={{ boxShadow: "none", background: "#fafbfc" }}>
            <div className="spread">
              <b>{a.subject}</b>
              <span className="muted" style={{ fontSize: 13 }}>
                {new Date(a.createdAt).toLocaleString()}
              </span>
            </div>
            <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{a.body}</p>
            <AttachmentList items={a.images} />
          </div>
        ))}
      </div>
    </div>
  );
}

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

// A category-locked composer. The card the participant clicked already decided the
// intent, so there's no type picker here — just their words, features, and images.
function FeedbackComposer({
  pilotId,
  spec,
  features,
  allComments,
  onPosted,
  onReplied,
  onCancel,
}: {
  pilotId: string;
  spec: ActionSpec;
  features: FeatureRef[];
  allComments: CommentItem[]; // every report in the pilot (for the similar-report thread)
  onPosted: () => void;
  onReplied: () => void; // refresh the board after replying to an existing report
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const { files, payload, addFiles, remove, dragging, dropzoneProps, pasteProps, max } = useImageAttach();
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarReport[]>([]);
  const [replyTarget, setReplyTarget] = useState<string | null>(null); // similar report opened for reply

  async function fetchSimilar(q: string) {
    try {
      const res = await api<{ matches: SimilarReport[] }>(
        `/my/pilots/${pilotId}/comments/similar?q=${encodeURIComponent(q)}`
      );
      setSimilar(res.matches);
    } catch {
      setSimilar([]); // a failed hint should never block posting
    }
  }

  // As the subject is typed, look for reports that already cover the same thing.
  useEffect(() => {
    const q = subject.trim();
    if (q.length < 3) {
      setSimilar([]);
      return;
    }
    const t = setTimeout(() => fetchSimilar(q), 300);
    return () => clearTimeout(t);
  }, [subject, pilotId]);

  function openReply(cid: string) {
    setReplyTarget((cur) => (cur === cid ? null : cid));
  }

  // Called after a reply is posted/deleted from an inline thread: refresh both
  // the board (so it's visible in context) and the similar-report counts.
  async function afterReplyChange() {
    await fetchSimilar(subject.trim());
    onReplied();
  }

  function toggleFeature(fid: string) {
    setFeatureIds((prev) => (prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]));
  }

  // Not an HTML form submit: this composer contains inline report threads (each
  // with their own <form>), and nested <form>s are invalid, so we post on click.
  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api(`/my/pilots/${pilotId}/comments`, {
        method: "POST",
        body: { subject: subject.trim() || undefined, body, category: spec.category, featureIds, images: payload, anonymous },
      });
      onPosted();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      className={`card composer tone-${spec.kind} dropzone ${dragging ? "is-dragover" : ""}`}
      style={{ marginTop: 16 }}
      {...dropzoneProps}
    >
      <DropOverlay show={dragging} max={max} />
      <div className="spread">
        <h2 style={{ margin: 0 }}>{spec.heading}</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, marginBottom: 0, fontSize: 13 }}>
        This is posted to everyone in the pilot under this lane.
      </p>
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      <label className="field" style={{ marginTop: 10 }}>
        <span>Subject (optional)</span>
        <input
          type="text"
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="A short headline"
        />
      </label>
      {similar.length > 0 && (
        <div className="similar-hint">
          <div className="similar-hint-head">
            Already reported? {similar.length === 1 ? "1 similar report" : `${similar.length} similar reports`}
          </div>
          <ul className="similar-list">
            {similar.map((m) => {
              const open = replyTarget === m.id;
              const full = allComments.find((c) => c.id === m.id);
              return (
                <li key={m.id} className="similar-item">
                  <button type="button" className="similar-row" onClick={() => openReply(m.id)}>
                    <span className="badge category-badge">{categoryLabel(m.category)}</span>
                    <span className="similar-text">
                      {m.subject?.trim() ? <b>{m.subject}</b> : m.snippet}
                      {m.replyCount > 0 && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {" "}· {m.replyCount} {m.replyCount === 1 ? "reply" : "replies"}
                        </span>
                      )}
                    </span>
                    <span className="similar-reply-cta">{open ? "Close" : "View & reply"}</span>
                  </button>
                  {open && full && (
                    <div className="similar-expanded">
                      <CommentCard
                        comment={full}
                        author={full.anonymous ? "Anonymous" : full.authorName ?? "Participant"}
                        company={full.company}
                        mine={full.mine}
                        replyBasePath={`/my/pilots/${pilotId}/comments/${full.id}/replies`}
                        allowAnonymousReply
                        onChanged={afterReplyChange}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Found yours here? Reply to it instead of posting a duplicate.
          </div>
        </div>
      )}
      <label className="field">
        <span>Your feedback</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          placeholder={spec.placeholder}
          {...pasteProps}
        />
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
      <div className="field">
        <label className="file-choose">
          <input
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          Choose files or drag and drop
        </label>
        <AttachmentPreviews files={files} onRemove={remove} />
      </div>
      <label className="chat-anon" style={{ marginTop: 18, marginBottom: 12 }}>
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span>Post anonymously — your name is hidden from everyone, including the organizer</span>
      </label>
      <button type="button" onClick={submit} disabled={busy || !body.trim()}>
        {busy ? "Posting…" : spec.cta}
      </button>
    </div>
  );
}

// The public board for one category: every participant's report in that lane,
// each with its discussion thread.
function ReportBoard({
  heading,
  pilotId,
  comments,
  onDelete,
  onChanged,
}: {
  heading: string;
  pilotId: string;
  comments: CommentItem[];
  onDelete: (cid: string) => void;
  onChanged: () => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>{heading}</h3>
      {comments.length === 0 ? (
        <p className="muted">Nothing here yet — be the first to post in this lane.</p>
      ) : (
        <div className="stack">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              author={c.anonymous ? "Anonymous" : c.authorName ?? "Participant"}
              company={c.company}
              mine={c.mine}
              onDelete={c.mine ? () => onDelete(c.id) : undefined}
              replyBasePath={`/my/pilots/${pilotId}/comments/${c.id}/replies`}
              allowAnonymousReply
              onChanged={onChanged}
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
  author,
  company,
  mine,
  headerExtra,
  footer,
  replyBasePath,
  allowAnonymousReply,
  canModerateReplies,
  onChanged,
}: {
  comment: CommentItem;
  onDelete?: () => void;
  author?: string | null;
  company?: string | null;
  mine?: boolean;
  headerExtra?: React.ReactNode; // extra badges next to the category (PM triage)
  footer?: React.ReactNode; // triage controls rendered below the body (PM only)
  replyBasePath?: string; // when set, shows the discussion thread + a reply box
  allowAnonymousReply?: boolean; // participant replies can be anonymous
  canModerateReplies?: boolean; // PM: can delete any reply
  onChanged?: () => void; // refresh after a reply is added/removed
}) {
  return (
    <div className="card" style={{ boxShadow: "none", background: "#fafbfc" }}>
      <div className="spread">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="badge category-badge">{categoryLabel(comment.category)}</span>
          {headerExtra}
          {author && <b>{author}</b>}
          {mine && <span className="muted" style={{ fontSize: 13 }}>· you</span>}
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
      {comment.subject && (
        <p style={{ margin: "10px 0 0", fontWeight: 600 }}>{comment.subject}</p>
      )}
      <p style={{ margin: `${comment.subject ? 4 : 10}px 0 0`, whiteSpace: "pre-wrap" }}>{comment.body}</p>
      {comment.features.length > 0 && (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {comment.features.map((f) => (
            <span key={f.id} className="chip">
              {f.name}
            </span>
          ))}
        </div>
      )}
      <AttachmentList items={comment.images} />
      {replyBasePath && (
        <ReplyThread
          basePath={replyBasePath}
          replies={comment.replies ?? []}
          allowAnonymous={!!allowAnonymousReply}
          canModerate={!!canModerateReplies}
          onChanged={onChanged ?? (() => {})}
        />
      )}
      {footer}
    </div>
  );
}

// The public discussion under a report: existing replies + a box to add one.
function ReplyThread({
  basePath,
  replies,
  allowAnonymous,
  canModerate,
  onChanged,
}: {
  basePath: string;
  replies: Reply[];
  allowAnonymous: boolean;
  canModerate: boolean;
  onChanged: () => void;
}) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api(basePath, { method: "POST", body: { body, ...(allowAnonymous ? { anonymous } : {}) } });
      setBody("");
      setAnonymous(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(rid: string) {
    setError(null);
    try {
      await api(`${basePath}/${rid}`, { method: "DELETE" });
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="reply-thread">
      {replies.length > 0 && (
        <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
          {replies.map((r) => (
            <div key={r.id} className="reply-row">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13 }}>{r.authorName ?? "Anonymous"}</b>
                {r.isOrganizer && <span className="badge chat-organizer">PM</span>}
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                {(r.mine || canModerate) && (
                  <button className="linkish" style={{ fontSize: 12 }} onClick={() => remove(r.id)}>
                    Delete
                  </button>
                )}
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{r.body}</div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={send} className="row" style={{ alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <input
          value={body}
          placeholder="Write a reply…"
          onChange={(e) => setBody(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        {allowAnonymous && (
          <label className="chat-anon" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>Anonymous</span>
          </label>
        )}
        <button type="submit" className="btn-sm" disabled={busy || !body.trim()}>
          {busy ? "…" : "Reply"}
        </button>
      </form>
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
