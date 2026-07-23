import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  useImageAttach,
  AttachButton,
  AttachmentPreviews,
  AttachmentList,
  DropOverlay,
  AttachmentRef,
} from "../ImageAttach";

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  isOrganizer: boolean;
  isMine: boolean;
  images: AttachmentRef[];
}

interface ChatPanelProps {
  basePath: string;
  heading?: string;
  blurb?: string;
  emptyText?: string;
}

// A private message thread backed by `basePath` (GET lists, POST sends). Used for
// a participant's "Ask a question" line to the PM, and one of the PM's threads.
export function ChatPanel({
  basePath,
  heading = "Ask a question",
  blurb = "A direct line to the organizer. Only you and the PM can see this.",
  emptyText = "No messages yet.",
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [body, setBody] = useState("");
  const { files, payload, count, addFiles, remove, clear, dragging, dropzoneProps, pasteProps, max } = useImageAttach();
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

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && count === 0) return;
    setError(null);
    setBusy(true);
    try {
      await api(basePath, { method: "POST", body: { body, images: payload } });
      setBody("");
      clear();
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

      <form onSubmit={send} className={`chat-composer dropzone ${dragging ? "is-dragover" : ""}`} {...dropzoneProps}>
        <DropOverlay show={dragging} max={max} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…"
          rows={2}
          {...pasteProps}
        />
        <AttachmentPreviews files={files} onRemove={remove} />
        <div className="spread" style={{ marginTop: 8 }}>
          <AttachButton onFiles={addFiles} />
          <button type="submit" disabled={busy || (!body.trim() && count === 0)}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatBubble({ message: m }: { message: ChatMessage }) {
  return (
    <div className={`chat-msg ${m.isMine ? "mine" : ""}`}>
      <div className="chat-bubble">
        <div className="chat-meta">
          <span className="chat-author">{m.authorName ?? "Participant"}</span>
          {m.isOrganizer && <span className="badge chat-organizer">PM</span>}
          <span className="chat-time">{new Date(m.createdAt).toLocaleString()}</span>
        </div>
        {m.body && <p className="chat-text">{m.body}</p>}
        <AttachmentList items={m.images} />
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

// The PM's inbox of participant question threads. Pick a thread to open its line.
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
        <button className="linkish" onClick={() => setSel(null)}>← All questions</button>
        <ChatPanel
          basePath={`/pilots/${pilotId}/chat/private/${sel.userId}`}
          heading={`${sel.name}${sel.company ? ` (${sel.company})` : ""}`}
          blurb="Only you and this participant can see this thread."
          emptyText="No messages in this thread yet."
        />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>Questions</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        Private lines from individual participants. Only you can see these.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!threads ? (
        <p className="muted">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="muted">No questions yet.</p>
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
