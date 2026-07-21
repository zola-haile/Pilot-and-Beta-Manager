import { FormEvent, useEffect, useRef, useState } from "react";
import { api, assetUrl } from "../api";
import { categoryLabel } from "../categories";

interface ChatReport {
  category: string;
  body: string;
  features: { id: string; name: string }[];
  images: { id: string; url: string }[];
}
export interface ChatMessage {
  id: string;
  body: string;
  kind: "PUBLIC" | "ANNOUNCEMENT" | "PRIVATE";
  createdAt: string;
  authorName: string | null; // null = anonymous
  isOrganizer: boolean;
  isMine: boolean;
  report: ChatReport | null;
  images: { id: string; url: string }[];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Thumbs({ images }: { images: { id: string; url: string }[] }) {
  if (images.length === 0) return null;
  return (
    <div className="thumb-row">
      {images.map((img) => (
        <div key={img.id} className="thumb">
          <a href={assetUrl(img.url)} target="_blank" rel="noreferrer">
            <img src={assetUrl(img.url)} alt="attachment" />
          </a>
        </div>
      ))}
    </div>
  );
}

interface ChatPanelProps {
  basePath: string;
  heading?: string;
  blurb?: string;
  emptyText?: string;
  allowAnonymous?: boolean; // show the "post anonymously" toggle (public only)
  allowAnnouncement?: boolean; // show the PM "post as announcement" toggle
}

// A message channel backed by `basePath` (GET lists, POST sends). Used for the
// public group channel, a participant's private line to the PM, and one of the
// PM's private threads.
export function ChatPanel({
  basePath,
  heading = "Pilot chat",
  blurb = "Everyone in this pilot is here — ask for clarification, compare notes, or share a report.",
  emptyText = "No messages yet.",
  allowAnonymous = true,
  allowAnnouncement = false,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function load(scroll: boolean) {
    try {
      const r = await api<{ messages: ChatMessage[] }>(basePath);
      setMessages(r.messages);
      if (scroll) scrollToEnd();
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    const dataUrls = await Promise.all(files.map(readFileAsDataUrl));
    setImages((prev) => [...prev, ...dataUrls].slice(0, 6));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && images.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      await api(basePath, {
        method: "POST",
        body: {
          body,
          images,
          ...(allowAnonymous ? { anonymous: announce ? false : anonymous } : {}),
          ...(allowAnnouncement ? { announcement: announce } : {}),
        },
      });
      setBody("");
      setImages([]);
      setAnnounce(false);
      await load(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card composer tone-talk" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>{heading}</h2>
      <p className="muted" style={{ marginTop: 4 }}>{blurb}</p>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="chat-log" ref={scrollRef}>
        {!messages ? (
          <p className="muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>{emptyText}</p>
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}
      </div>

      <form onSubmit={send} className="chat-composer">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={announce ? "Write an announcement for everyone…" : "Write a message…"}
          rows={2}
        />
        {images.length > 0 && (
          <div className="thumb-row" style={{ marginTop: 8 }}>
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
        <div className="spread" style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 16 }}>
            <label className="chat-attach" title="Attach images (up to 6)">
              <input type="file" accept="image/*" multiple onChange={onPickImages} />
              <span>Attach</span>
            </label>
            {allowAnonymous && (
              <label className="chat-anon">
                <input
                  type="checkbox"
                  checked={anonymous}
                  disabled={announce}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <span>Post anonymously</span>
              </label>
            )}
            {allowAnnouncement && (
              <label className="chat-anon">
                <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
                <span>Post as announcement</span>
              </label>
            )}
          </div>
          <button type="submit" disabled={busy || (!body.trim() && images.length === 0)}>
            {busy ? "Sending…" : announce ? "Announce" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatBubble({ message: m }: { message: ChatMessage }) {
  if (m.kind === "ANNOUNCEMENT") {
    return (
      <div className="chat-announce">
        <div className="chat-announce__head">
          <span>Announcement</span>
          {m.authorName && <span className="muted">· {m.authorName}</span>}
          <span className="chat-time">{new Date(m.createdAt).toLocaleString()}</span>
        </div>
        {m.body && <p className="chat-text" style={{ marginTop: 6 }}>{m.body}</p>}
        <Thumbs images={m.images} />
      </div>
    );
  }
  return (
    <div className={`chat-msg ${m.isMine ? "mine" : ""}`}>
      <div className="chat-bubble">
        <div className="chat-meta">
          <span className="chat-author">{m.authorName ?? "Anonymous"}</span>
          {m.isOrganizer && <span className="badge chat-organizer">PM</span>}
          <span className="chat-time">{new Date(m.createdAt).toLocaleString()}</span>
        </div>
        {m.body && <p className="chat-text">{m.body}</p>}
        <Thumbs images={m.images} />
        {m.report && (
          <div className="chat-report">
            <span className="badge category-badge">{categoryLabel(m.report.category)}</span>
            <p className="chat-text" style={{ marginTop: 8 }}>{m.report.body}</p>
            {m.report.features.length > 0 && (
              <div className="chip-row" style={{ marginTop: 8 }}>
                {m.report.features.map((f) => (
                  <span key={f.id} className="chip">{f.name}</span>
                ))}
              </div>
            )}
            {m.report.images.length > 0 && (
              <div className="thumb-row">
                {m.report.images.map((img) => (
                  <div key={img.id} className="thumb">
                    <a href={assetUrl(img.url)} target="_blank" rel="noreferrer">
                      <img src={assetUrl(img.url)} alt="attachment" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface PrivateThread {
  userId: string;
  name: string;
  company: string | null;
  count: number;
  lastAt: string;
}

// The PM's inbox of private participant threads. Pick a thread to open its line.
export function PrivateThreadsPanel({ pilotId }: { pilotId: string }) {
  const [threads, setThreads] = useState<PrivateThread[] | null>(null);
  const [sel, setSel] = useState<PrivateThread | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api<{ threads: PrivateThread[] }>(`/pilots/${pilotId}/chat/private`);
      setThreads(r.threads);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilotId]);

  if (sel) {
    return (
      <div style={{ marginTop: 16 }}>
        <button className="linkish" onClick={() => setSel(null)}>← All private messages</button>
        <ChatPanel
          basePath={`/pilots/${pilotId}/chat/private/${sel.userId}`}
          heading={`Private · ${sel.name}${sel.company ? ` (${sel.company})` : ""}`}
          blurb="Only you and this participant can see this thread."
          emptyText="No messages in this thread yet."
          allowAnonymous={false}
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>Private messages</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Direct lines from individual participants. Only you can see these.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!threads ? (
        <p className="muted">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="muted">No private messages yet.</p>
      ) : (
        <div className="stack" style={{ marginTop: 8 }}>
          {threads.map((t) => (
            <button key={t.userId} className="thread-row" onClick={() => setSel(t)}>
              <div>
                <b>{t.name}</b>
                {t.company && <span className="muted"> · {t.company}</span>}
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(t.lastAt).toLocaleDateString()}
                </span>
                <span className="tabbtn__count">{t.count}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
