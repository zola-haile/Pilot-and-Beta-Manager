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
