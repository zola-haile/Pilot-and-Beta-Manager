// Comment category labels — mirrors the backend enum (src/lib/comments.ts).
export const CATEGORY_LABELS: Record<string, string> = {
  ENHANCEMENT: "Enhancement",
  BUG: "Bug / defect",
  FEATURE_REQUEST: "New feature request",
  REMOVE_FEATURE: "Should be removed",
  USABILITY: "Usability issue",
  PERFORMANCE: "Performance issue",
  PRAISE: "Praise / working well",
  QUESTION: "Question",
  OTHER: "Other",
};

export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value;
}

// Triage status labels — mirrors the backend CommentStatus enum.
export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  WONT_DO: "Won't do",
  DUPLICATE: "Duplicate",
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

// Priority labels — mirrors the backend CommentPriority enum.
export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export function priorityLabel(value: string): string {
  return PRIORITY_LABELS[value] ?? value;
}

// Stable colors per category, used across the analytics charts.
export const CATEGORY_COLORS: Record<string, string> = {
  ENHANCEMENT: "#6366f1",
  BUG: "#dc2626",
  FEATURE_REQUEST: "#0ea5e9",
  REMOVE_FEATURE: "#b45309",
  USABILITY: "#d97706",
  PERFORMANCE: "#db2777",
  PRAISE: "#059669",
  QUESTION: "#7c3aed",
  OTHER: "#6b7280",
};

export function categoryColor(value: string): string {
  return CATEGORY_COLORS[value] ?? "#6b7280";
}

export const SENTIMENT_COLORS = {
  positive: "#059669",
  neutral: "#9ca3af",
  negative: "#dc2626",
};
