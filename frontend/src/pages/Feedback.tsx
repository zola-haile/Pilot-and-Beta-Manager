import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner } from "../components";
import { categoryLabel, priorityLabel, statusLabel } from "../categories";
import { CommentCard } from "./ParticipantForm";

/* ------------------------------- Types ------------------------------- */

export interface TriageNote {
  id: string;
  body: string;
  createdAt: string;
}
export interface Option {
  value: string;
  label: string;
}
export interface ThemeRef {
  id: string;
  name: string;
}
export interface FeedbackComment {
  id: string;
  body: string;
  category: string;
  createdAt: string;
  author: { name: string | null; email: string };
  company: string | null;
  pilot?: { id: string; name: string }; // present in app scope
  features: { id: string; name: string }[];
  images: { id: string; url: string }[];
  status: string;
  priority: string | null;
  assignee: string | null;
  duplicateOfId: string | null;
  duplicateCount: number;
  theme: ThemeRef | null;
  notes: TriageNote[];
}

interface FeedbackResponse {
  comments: FeedbackComment[];
  statuses: Option[];
  priorities: Option[];
  themes: ThemeRef[];
}

const STATUS_ORDER = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS", "DONE", "WONT_DO", "DUPLICATE"];
const OPEN_STATUSES = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS"];

export function shortLabel(c: FeedbackComment): string {
  const who = c.author.name ?? c.author.email;
  const snippet = c.body.length > 40 ? `${c.body.slice(0, 40)}…` : c.body;
  return `${who}: ${snippet}`;
}

/* ============================ Route wrapper =========================== */

export function FeedbackPage() {
  const { appId } = useParams();
  const [appName, setAppName] = useState<string | null>(null);

  useEffect(() => {
    api<{ application: { name: string } }>(`/applications/${appId}`)
      .then((r) => setAppName(r.application.name))
      .catch(() => setAppName(""));
  }, [appId]);

  return (
    <Layout>
      <Link to={`/applications/${appId}`} className="muted" style={{ fontSize: 14 }}>
        ← Back to project
      </Link>
      <div className="row" style={{ marginTop: 10, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Feedback{appName ? ` · ${appName}` : ""}</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Every comment across all of this project's pilots.
      </p>
      <FeedbackWorkspace scope="app" fetchPath={`/applications/${appId}/comments`} applicationId={appId!} />
    </Layout>
  );
}

/* ========================= The workspace engine ======================= */

type FilterState = {
  query: string;
  category: string;
  feature: string;
  company: string;
  status: string;
  priority: string;
  pilot: string;
  from: string;
  to: string;
  hasImages: boolean;
};

const EMPTY_FILTERS: FilterState = {
  query: "",
  category: "ALL",
  feature: "ALL",
  company: "ALL",
  status: "ALL",
  priority: "ALL",
  pilot: "ALL",
  from: "",
  to: "",
  hasImages: false,
};

export function FeedbackWorkspace({
  scope,
  fetchPath,
  applicationId,
  pilotId,
}: {
  scope: "app" | "pilot";
  fetchPath: string;
  applicationId: string;
  pilotId?: string; // pilot scope: the shared pilot id
}) {
  const [comments, setComments] = useState<FeedbackComment[] | null>(null);
  const [statuses, setStatuses] = useState<Option[]>([]);
  const [priorities, setPriorities] = useState<Option[]>([]);
  const [themes, setThemes] = useState<ThemeRef[]>([]);
  const [view, setView] = useState<"board" | "table">("table");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api<FeedbackResponse>(fetchPath);
      setComments(r.comments);
      setStatuses(r.statuses);
      setPriorities(r.priorities);
      setThemes(r.themes);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [fetchPath]);

  const pilotIdOf = (c: FeedbackComment) => c.pilot?.id ?? pilotId ?? "";

  // Distinct filter options derived from the data present.
  const options = useMemo(() => {
    const cats = new Set<string>();
    const feats = new Map<string, string>();
    const comps = new Set<string>();
    const pilots = new Map<string, string>();
    for (const c of comments ?? []) {
      cats.add(c.category);
      c.features.forEach((f) => feats.set(f.id, f.name));
      if (c.company) comps.add(c.company);
      if (c.pilot) pilots.set(c.pilot.id, c.pilot.name);
    }
    return {
      categories: [...cats],
      features: [...feats.entries()],
      companies: [...comps].sort(),
      pilots: [...pilots.entries()],
    };
  }, [comments]);

  function matches(c: FeedbackComment, ignoreStatus = false): boolean {
    const f = filters;
    if (!ignoreStatus && f.status !== "ALL" && c.status !== f.status) return false;
    if (f.category !== "ALL" && c.category !== f.category) return false;
    if (f.priority !== "ALL" && (c.priority ?? "") !== f.priority) return false;
    if (f.company !== "ALL" && c.company !== f.company) return false;
    if (f.pilot !== "ALL" && c.pilot?.id !== f.pilot) return false;
    if (f.feature !== "ALL" && !c.features.some((x) => x.id === f.feature)) return false;
    if (f.hasImages && c.images.length === 0) return false;
    if (f.from && new Date(c.createdAt) < new Date(f.from)) return false;
    if (f.to && new Date(c.createdAt) > new Date(f.to + "T23:59:59")) return false;
    if (f.query.trim()) {
      const q = f.query.trim().toLowerCase();
      const hay = `${c.body} ${c.assignee ?? ""} ${c.author.name ?? ""} ${c.author.email} ${
        c.company ?? ""
      } ${c.features.map((x) => x.name).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  const filtered = useMemo(
    () => (comments ?? []).filter((c) => matches(c)),
    [comments, filters]
  );
  // For the board, status is expressed by columns, so ignore the status filter.
  const boardFiltered = useMemo(
    () => (comments ?? []).filter((c) => matches(c, true)),
    [comments, filters]
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of comments ?? []) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [comments]);
  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  const activeFilterCount =
    (filters.query.trim() ? 1 : 0) +
    ["category", "feature", "company", "status", "priority", "pilot"].filter(
      (k) => (filters as any)[k] !== "ALL"
    ).length +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.hasImages ? 1 : 0);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function reloadKeepingSelection() {
    await load();
  }

  // Move one comment to a new status (used by board drag-and-drop).
  async function setStatus(c: FeedbackComment, status: string) {
    if (c.status === status) return;
    try {
      await api(`/pilots/${pilotIdOf(c)}/comments/${c.id}`, { method: "PATCH", body: { status } });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error && !comments) return <div className="alert alert-error">{error}</div>;
  if (!comments) return <Spinner />;

  const selectedComments = comments.filter((c) => selected.has(c.id));

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div className="row">
          <div className="seg">
            <button
              className={view === "table" ? "seg-on" : ""}
              onClick={() => setView("table")}
            >
              ▤ Inbox
            </button>
            <button
              className={view === "board" ? "seg-on" : ""}
              onClick={() => setView("board")}
            >
              ▦ Board
            </button>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>
            {filtered.length} of {comments.length} · {openCount} open
          </span>
        </div>
        {activeFilterCount > 0 && (
          <button className="btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <FilterBar
        scope={scope}
        filters={filters}
        setFilters={setFilters}
        statuses={statuses}
        priorities={priorities}
        options={options}
        showStatus={view === "table"}
      />

      {selected.size > 0 && (
        <BulkBar
          applicationId={applicationId}
          selected={selectedComments}
          statuses={statuses}
          priorities={priorities}
          themes={themes}
          allComments={comments}
          onDone={() => {
            clearSelection();
            load();
          }}
          onError={setError}
          onClear={clearSelection}
        />
      )}

      {comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : view === "table" ? (
        <InboxTable
          rows={filtered}
          scope={scope}
          selected={selected}
          onToggle={toggleSelect}
          onToggleAll={(on) =>
            setSelected(on ? new Set(filtered.map((c) => c.id)) : new Set())
          }
          renderDetail={(c) => (
            <CommentCard
              comment={c}
              author={c.author.name ?? c.author.email}
              company={c.company}
              footer={
                <TriagePanel
                  pilotId={pilotIdOf(c)}
                  applicationId={applicationId}
                  comment={c}
                  statuses={statuses}
                  priorities={priorities}
                  themes={themes}
                  allComments={comments.filter((o) => pilotIdOf(o) === pilotIdOf(c))}
                  onChange={reloadKeepingSelection}
                />
              }
            />
          )}
        />
      ) : (
        <Board
          statuses={statuses}
          rows={boardFiltered}
          scope={scope}
          selected={selected}
          onToggle={toggleSelect}
          onDropTo={setStatus}
        />
      )}
    </div>
  );
}

/* ------------------------------ Filter bar ---------------------------- */

function FilterBar({
  scope,
  filters,
  setFilters,
  statuses,
  priorities,
  options,
  showStatus,
}: {
  scope: "app" | "pilot";
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  statuses: Option[];
  priorities: Option[];
  options: {
    categories: string[];
    features: [string, string][];
    companies: string[];
    pilots: [string, string][];
  };
  showStatus: boolean;
}) {
  const set = (patch: Partial<FilterState>) => setFilters({ ...filters, ...patch });
  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <input
          placeholder="Search feedback…"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          style={{ flex: 2, minWidth: 200 }}
        />
        <select value={filters.category} onChange={(e) => set({ category: e.target.value })} style={{ width: "auto" }}>
          <option value="ALL">Any type</option>
          {options.categories.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        {showStatus && (
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} style={{ width: "auto" }}>
            <option value="ALL">Any status</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <select value={filters.priority} onChange={(e) => set({ priority: e.target.value })} style={{ width: "auto" }}>
          <option value="ALL">Any priority</option>
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {options.features.length > 0 && (
          <select value={filters.feature} onChange={(e) => set({ feature: e.target.value })} style={{ width: "auto" }}>
            <option value="ALL">Any feature</option>
            {options.features.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {options.companies.length > 0 && (
          <select value={filters.company} onChange={(e) => set({ company: e.target.value })} style={{ width: "auto" }}>
            <option value="ALL">Any company</option>
            {options.companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {scope === "app" && options.pilots.length > 0 && (
          <select value={filters.pilot} onChange={(e) => set({ pilot: e.target.value })} style={{ width: "auto" }}>
            <option value="ALL">Any pilot</option>
            {options.pilots.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <span className="muted">From</span>
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} style={{ width: "auto" }} />
        </label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <span className="muted">To</span>
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} style={{ width: "auto" }} />
        </label>
        <label className="inline-check" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={filters.hasImages} onChange={(e) => set({ hasImages: e.target.checked })} />
          <span>Has images</span>
        </label>
      </div>
    </div>
  );
}

/* -------------------------------- Bulk bar ---------------------------- */

function BulkBar({
  applicationId,
  selected,
  statuses,
  priorities,
  themes,
  allComments,
  onDone,
  onError,
  onClear,
}: {
  applicationId: string;
  selected: FeedbackComment[];
  statuses: Option[];
  priorities: Option[];
  themes: ThemeRef[];
  allComments: FeedbackComment[];
  onDone: () => void;
  onError: (m: string) => void;
  onClear: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const ids = selected.map((c) => c.id);

  async function bulk(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/applications/${applicationId}/comments/bulk`, {
        method: "PATCH",
        body: { commentIds: ids, ...body },
      });
      onDone();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    const who = prompt("Assign selected to (leave blank to unassign):", "");
    if (who === null) return;
    bulk({ assignee: who.trim() || null });
  }

  async function pickTheme(value: string) {
    if (!value) return;
    if (value === "__new__") {
      const name = prompt("Name a new theme for these comments:");
      if (!name || !name.trim()) return;
      try {
        const r = await api<{ theme: ThemeRef }>(`/applications/${applicationId}/themes`, {
          method: "POST",
          body: { name: name.trim() },
        });
        bulk({ themeId: r.theme.id });
      } catch (err: any) {
        onError(err.message);
      }
    } else {
      bulk({ themeId: value });
    }
  }

  // Merge is only valid when every selection is in one pilot; the canonical must
  // be another comment in that same pilot.
  const pilotIds = new Set(selected.map((c) => c.pilot?.id ?? "one"));
  const singlePilot = pilotIds.size === 1;
  const mergeCandidates = singlePilot
    ? allComments.filter(
        (o) => !ids.includes(o.id) && (o.pilot?.id ?? "one") === [...pilotIds][0]
      )
    : [];

  return (
    <div className="bulkbar">
      <b>{selected.length} selected</b>
      <select disabled={busy} value="" onChange={(e) => e.target.value && bulk({ status: e.target.value })}>
        <option value="">Set status…</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        disabled={busy}
        value=""
        onChange={(e) => e.target.value && bulk({ priority: e.target.value === "NONE" ? null : e.target.value })}
      >
        <option value="">Set priority…</option>
        {priorities.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="NONE">Clear priority</option>
      </select>
      <button className="btn-ghost btn-sm" disabled={busy} onClick={assign}>
        Assign…
      </button>
      <select disabled={busy} value="" onChange={(e) => pickTheme(e.target.value)}>
        <option value="">Add to theme…</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value="__new__">+ New theme…</option>
      </select>
      {singlePilot && mergeCandidates.length > 0 && (
        <select disabled={busy} value="" onChange={(e) => e.target.value && bulk({ duplicateOfId: e.target.value })}>
          <option value="">Merge into…</option>
          {mergeCandidates.map((o) => (
            <option key={o.id} value={o.id}>
              {shortLabel(o)}
            </option>
          ))}
        </select>
      )}
      <button className="btn-ghost btn-sm" disabled={busy} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

/* ------------------------------ Inbox table --------------------------- */

function InboxTable({
  rows,
  scope,
  selected,
  onToggle,
  onToggleAll,
  renderDetail,
}: {
  rows: FeedbackComment[];
  scope: "app" | "pilot";
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  renderDetail: (c: FeedbackComment) => React.ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  if (rows.length === 0) return <p className="muted">No comments match those filters.</p>;

  return (
    <div className="table-wrap">
      <table className="feedback-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input type="checkbox" checked={allOn} onChange={(e) => onToggleAll(e.target.checked)} />
            </th>
            <th>Feedback</th>
            <th>Company</th>
            {scope === "app" && <th>Pilot</th>}
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Fragment key={c.id}>
              <tr className={selected.has(c.id) ? "row-selected" : ""}>
                <td>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
                </td>
                <td>
                  <span className="badge category-badge" style={{ marginRight: 6 }}>
                    {categoryLabel(c.category)}
                  </span>
                  <a role="button" onClick={() => toggleOpen(c.id)} style={{ cursor: "pointer" }}>
                    {c.body.length > 70 ? `${c.body.slice(0, 70)}…` : c.body}
                  </a>
                  {c.images.length > 0 && <span title="has images"> 🖼</span>}
                  {c.duplicateOfId && <span className="muted"> · dup</span>}
                  {c.duplicateCount > 0 && <span className="muted"> · 🔁{c.duplicateCount}</span>}
                  {c.theme && <span className="chip" style={{ marginLeft: 6 }}>🔖 {c.theme.name}</span>}
                </td>
                <td className="muted">{c.company ?? "—"}</td>
                {scope === "app" && (
                  <td className="muted">{c.pilot?.name ?? "—"}</td>
                )}
                <td>
                  <span className={`badge status-${c.status}`}>{statusLabel(c.status)}</span>
                </td>
                <td>
                  {c.priority ? (
                    <span className={`badge prio-${c.priority}`}>{priorityLabel(c.priority)}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="muted">{c.assignee ?? "—"}</td>
                <td>
                  <button className="btn-ghost btn-sm" onClick={() => toggleOpen(c.id)}>
                    {open.has(c.id) ? "▲" : "▼"}
                  </button>
                </td>
              </tr>
              {open.has(c.id) && (
                <tr>
                  <td colSpan={scope === "app" ? 8 : 7} style={{ background: "#fafbfc" }}>
                    {renderDetail(c)}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- Board ------------------------------ */

function Board({
  statuses,
  rows,
  scope,
  selected,
  onToggle,
  onDropTo,
}: {
  statuses: Option[];
  rows: FeedbackComment[];
  scope: "app" | "pilot";
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDropTo: (c: FeedbackComment, status: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const byId = new Map(rows.map((c) => [c.id, c]));
  const ordered = statuses.slice().sort((a, b) => STATUS_ORDER.indexOf(a.value) - STATUS_ORDER.indexOf(b.value));

  function drop(status: string) {
    const c = dragId ? byId.get(dragId) : null;
    if (c) onDropTo(c, status);
    setDragId(null);
    setOverCol(null);
  }

  return (
    <div className="board">
      {ordered.map((s) => {
        const cards = rows.filter((c) => c.status === s.value);
        return (
          <div
            key={s.value}
            className={`board-col ${overCol === s.value ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(s.value);
            }}
            onDragLeave={() => setOverCol((v) => (v === s.value ? null : v))}
            onDrop={() => drop(s.value)}
          >
            <div className="board-col-head">
              <span className={`badge status-${s.value}`}>{s.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {cards.length}
              </span>
            </div>
            <div className="board-col-body">
              {cards.map((c) => (
                <div
                  key={c.id}
                  className={`board-card ${selected.has(c.id) ? "card-selected" : ""}`}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="badge category-badge">{categoryLabel(c.category)}</span>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => onToggle(c.id)}
                    />
                  </div>
                  <div style={{ fontSize: 13, margin: "6px 0" }}>
                    {c.body.length > 90 ? `${c.body.slice(0, 90)}…` : c.body}
                  </div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 5 }}>
                    {c.priority && <span className={`badge prio-${c.priority}`}>{priorityLabel(c.priority)}</span>}
                    {c.company && <span className="muted" style={{ fontSize: 12 }}>{c.company}</span>}
                    {scope === "app" && c.pilot && (
                      <span className="muted" style={{ fontSize: 12 }}>· {c.pilot.name}</span>
                    )}
                    {c.images.length > 0 && <span style={{ fontSize: 12 }}>🖼</span>}
                  </div>
                  {c.assignee && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      @ {c.assignee}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ TriagePanel --------------------------- */

export function TriagePanel({
  pilotId,
  applicationId,
  comment,
  statuses,
  priorities,
  themes,
  allComments,
  onChange,
}: {
  pilotId: string;
  applicationId: string;
  comment: FeedbackComment;
  statuses: Option[];
  priorities: Option[];
  themes: ThemeRef[];
  allComments: FeedbackComment[];
  onChange: () => void;
}) {
  const [assignee, setAssignee] = useState(comment.assignee ?? "");
  const [note, setNote] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dupeCandidates = allComments.filter(
    (o) => o.id !== comment.id && o.duplicateOfId !== comment.id
  );

  async function patch(body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      await api(`/pilots/${pilotId}/comments/${comment.id}`, { method: "PATCH", body });
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickTheme(value: string) {
    if (value === "__new__") {
      const name = prompt("Name this theme (a recurring insight across pilots):");
      if (!name || !name.trim()) return;
      try {
        const r = await api<{ theme: ThemeRef }>(`/applications/${applicationId}/themes`, {
          method: "POST",
          body: { name: name.trim() },
        });
        await patch({ themeId: r.theme.id });
      } catch (err: any) {
        setError(err.message);
      }
    } else {
      patch({ themeId: value || null });
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setError(null);
    try {
      await api(`/pilots/${pilotId}/comments/${comment.id}/notes`, {
        method: "POST",
        body: { body: note.trim() },
      });
      setNote("");
      onChange();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeNote(nid: string) {
    await api(`/pilots/${pilotId}/comments/${comment.id}/notes/${nid}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="triage" style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <label className="triage-ctl">
          <span>Status</span>
          <select value={comment.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="triage-ctl">
          <span>Priority</span>
          <select
            value={comment.priority ?? ""}
            disabled={busy}
            onChange={(e) => patch({ priority: e.target.value || null })}
          >
            <option value="">—</option>
            {priorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="triage-ctl" style={{ flex: 1, minWidth: 140 }}>
          <span>Assignee</span>
          <input
            value={assignee}
            placeholder="Unassigned"
            onChange={(e) => setAssignee(e.target.value)}
            onBlur={() => {
              if ((comment.assignee ?? "") !== assignee) patch({ assignee: assignee || null });
            }}
          />
        </label>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        <label className="triage-ctl" style={{ flex: 1, minWidth: 180 }}>
          <span>Duplicate of</span>
          <select
            value={comment.duplicateOfId ?? ""}
            disabled={busy}
            onChange={(e) => patch({ duplicateOfId: e.target.value || null })}
          >
            <option value="">Not a duplicate</option>
            {dupeCandidates.map((o) => (
              <option key={o.id} value={o.id}>
                {shortLabel(o)}
              </option>
            ))}
          </select>
        </label>
        <label className="triage-ctl" style={{ flex: 1, minWidth: 180 }}>
          <span>Theme</span>
          <select value={comment.theme?.id ?? ""} disabled={busy} onChange={(e) => pickTheme(e.target.value)}>
            <option value="">No theme</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="__new__">+ New theme…</option>
          </select>
        </label>
      </div>

      {comment.duplicateCount > 0 && (
        <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
          🔁 {comment.duplicateCount} other {comment.duplicateCount === 1 ? "comment marks" : "comments mark"} this as
          the canonical report.
        </p>
      )}

      <button
        type="button"
        className="btn-ghost btn-sm"
        style={{ marginTop: 10 }}
        onClick={() => setShowNotes((v) => !v)}
      >
        {showNotes ? "Hide" : "Show"} internal notes ({comment.notes.length})
      </button>
      {showNotes && (
        <div style={{ marginTop: 10 }}>
          {comment.notes.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Private to your team — participants never see these.
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {comment.notes.map((n) => (
                <div key={n.id} className="spread" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{n.body}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <button className="btn-danger btn-sm" onClick={() => removeNote(n.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addNote} className="row" style={{ marginTop: 10, alignItems: "flex-start" }}>
            <input
              value={note}
              placeholder="Add an internal note…"
              onChange={(e) => setNote(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-sm" disabled={!note.trim()}>
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
