export type PilotStatus = "draft" | "upcoming" | "active" | "past";

/**
 * Derives a pilot's status from its start/end dates.
 * - no dates at all            -> "draft"
 * - now is before start        -> "upcoming"
 * - now is after end           -> "past"
 * - otherwise (within window)  -> "active"
 */
export function pilotStatus(
  startDate: Date | null,
  endDate: Date | null,
  now: Date = new Date()
): PilotStatus {
  if (!startDate && !endDate) return "draft";
  if (startDate && now < startDate) return "upcoming";
  if (endDate && now > endDate) return "past";
  return "active";
}
