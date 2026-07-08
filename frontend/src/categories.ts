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
