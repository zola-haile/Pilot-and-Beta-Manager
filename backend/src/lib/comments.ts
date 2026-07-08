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
