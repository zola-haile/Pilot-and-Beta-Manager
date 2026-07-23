// The comment categories participants can pick from. Single source of truth,
// exposed to the frontend via the pilot view so the two never drift.
export const COMMENT_CATEGORIES = [
  { value: "ENHANCEMENT", label: "Enhancement" },
  { value: "BUG", label: "Bug / defect" },
  { value: "FEATURE_REQUEST", label: "New feature request" },
  { value: "REMOVE_FEATURE", label: "Should be removed" },
  { value: "USABILITY", label: "Usability issue" },
  { value: "PERFORMANCE", label: "Performance issue" },
  { value: "PRAISE", label: "Praise / working well" },
  { value: "QUESTION", label: "Question" },
  { value: "OTHER", label: "Other" },
] as const;

export const CATEGORY_VALUES = COMMENT_CATEGORIES.map((c) => c.value) as [string, ...string[]];

// Triage workflow statuses the PM moves a comment through.
export const COMMENT_STATUSES = [
  { value: "NEW", label: "New" },
  { value: "TRIAGED", label: "Triaged" },
  { value: "PLANNED", label: "Planned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DONE", label: "Done" },
  { value: "WONT_DO", label: "Won't do" },
  { value: "DUPLICATE", label: "Duplicate" },
] as const;

export const STATUS_VALUES = COMMENT_STATUSES.map((s) => s.value) as [string, ...string[]];

export const COMMENT_PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
] as const;

export const PRIORITY_VALUES = COMMENT_PRIORITIES.map((p) => p.value) as [string, ...string[]];

/* ------------------------ Similarity matching ------------------------- */
// Lightweight, dependency-free text matching used to surface reports whose
// subject/body overlaps with what a participant is typing, so they can spot a
// duplicate before posting. Deliberately simple (token overlap + prefixes) —
// pilots hold at most a few dozen reports, so we score in memory.

const STOP_WORDS = new Set([
  "the", "and", "for", "not", "but", "with", "this", "that", "have", "has",
  "was", "are", "you", "your", "can", "cant", "cannot", "there", "when",
  "how", "why", "what", "into", "from", "its", "our", "get", "got",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** How many of the query's meaningful tokens appear in `text` (exact or as a prefix). */
export function similarityScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const candidate = tokenize(text);
  let hits = 0;
  for (const q of queryTokens) {
    if (candidate.some((c) => c === q || (q.length >= 4 && (c.startsWith(q) || q.startsWith(c))))) {
      hits++;
    }
  }
  return hits;
}

/* ----------------------- Shared serialization ------------------------ */
// Reports are public to everyone in a pilot; `anonymous` reports/replies hide the
// author's identity from peers AND the PM (absolute). These helpers centralize
// that rule so no route accidentally leaks a name behind an anonymous post.

import { signUploadPath } from "./uploads";

export interface ReplyRow {
  id: string;
  body: string;
  anonymous: boolean;
  createdAt: Date;
  userId: string;
  user: { name: string | null };
}

export interface ReplyView {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string | null; // null = anonymous
  isOrganizer: boolean;
  mine: boolean;
}

export function serializeReply(r: ReplyRow, viewerId: string, ownerPmId: string): ReplyView {
  const isOrganizer = !r.anonymous && r.userId === ownerPmId;
  return {
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    authorName: r.anonymous ? null : r.user.name?.trim() || (isOrganizer ? "Organizer" : "Participant"),
    isOrganizer,
    mine: r.userId === viewerId,
  };
}

export interface BoardCommentRow {
  id: string;
  subject: string | null;
  body: string;
  category: string;
  anonymous: boolean;
  createdAt: Date;
  userId: string;
  user: { id: string; name: string | null };
  features: { id: string; name: string }[];
  images: { id: string; url: string; name: string | null; mime: string | null }[];
  replies: ReplyRow[];
}

/** A report as seen on the participant-facing public board (identity hidden when anonymous). */
export function serializeBoardComment(
  c: BoardCommentRow,
  viewerId: string,
  ownerPmId: string,
  companyByUser: Map<string, string>
) {
  return {
    id: c.id,
    subject: c.subject,
    body: c.body,
    category: c.category,
    createdAt: c.createdAt,
    anonymous: c.anonymous,
    authorName: c.anonymous ? null : c.user.name?.trim() || "Participant",
    company: c.anonymous ? null : companyByUser.get(c.userId) ?? null,
    mine: c.userId === viewerId,
    features: c.features.map((f) => ({ id: f.id, name: f.name })),
    images: c.images.map((i) => ({ id: i.id, url: signUploadPath(i.url), name: i.name, mime: i.mime })),
    replies: c.replies.map((r) => serializeReply(r, viewerId, ownerPmId)),
  };
}
