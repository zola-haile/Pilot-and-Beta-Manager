// Client-side file export. The backend hands us one structured JSON blob per
// pilot; here we turn it into downloadable JSON or per-dataset CSV files so the
// PM can open them in a spreadsheet or feed them into Productboard's importer.

export interface PilotExport {
  exportedAt: string;
  project: string;
  pilot: { id: string; name: string; description: string | null; status: string; startDate: string | null; endDate: string | null };
  features: { id: string; name: string }[];
  questions: { id: string; label: string; type: string; required: boolean }[];
  comments: {
    id: string; category: string; subject: string | null; body: string; status: string; priority: string | null;
    assignee: string | null; theme: string | null; features: string[]; imageCount: number;
    createdAt: string; anonymous: boolean;
    author: { name: string | null; email: string | null; company: string | null };
    replies: {
      id: string; body: string; createdAt: string; anonymous: boolean;
      author: { name: string | null; email: string | null; company: string | null };
    }[];
  }[];
  responses: {
    id: string; submittedAt: string;
    participant: { name: string | null; email: string; company: string | null };
    answers: Record<string, string | null>;
  }[];
  featureRatings: {
    summary: { feature: string; average: number | null; count: number }[];
    entries: { feature: string; stars: number; participant: { name: string | null; email: string; company: string | null }; updatedAt: string }[];
  };
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "pilot";
}

// ---- per-dataset CSV builders ------------------------------------------------

// Reports keep anonymity: an anonymous report exports with a blank author, never a name.
export function commentsCsv(x: PilotExport): string {
  const headers = [
    "id", "category", "status", "priority", "assignee", "theme", "features",
    "images", "replies", "createdAt", "author", "email", "company", "subject", "body",
  ];
  const rows = x.comments.map((c) => [
    c.id, c.category, c.status, c.priority, c.assignee, c.theme, c.features.join("; "),
    c.imageCount, c.replies.length, c.createdAt,
    c.anonymous ? "Anonymous" : c.author.name, c.author.email, c.author.company, c.subject, c.body,
  ]);
  return toCsv(headers, rows);
}

export function responsesCsv(x: PilotExport): string {
  const qLabels = x.questions.map((q) => q.label);
  const headers = ["id", "submittedAt", "participant", "email", "company", ...qLabels];
  const rows = x.responses.map((r) => [
    r.id, r.submittedAt, r.participant.name, r.participant.email, r.participant.company,
    ...qLabels.map((label) => r.answers[label] ?? ""),
  ]);
  return toCsv(headers, rows);
}

export function ratingsCsv(x: PilotExport): string {
  const headers = ["feature", "stars", "participant", "email", "company", "updatedAt"];
  const rows = x.featureRatings.entries.map((e) => [
    e.feature, e.stars, e.participant.name, e.participant.email, e.participant.company, e.updatedAt,
  ]);
  return toCsv(headers, rows);
}

export function exportBaseName(x: PilotExport): string {
  return `${slug(x.project)}-${slug(x.pilot.name)}`;
}
