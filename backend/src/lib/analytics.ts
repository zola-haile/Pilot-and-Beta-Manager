// Deterministic analytics helpers over comments and structured answers.
// Sentiment is derived from a comment's category (no ML) so the "sentiment
// trend" is explainable: praise is positive, defects/removals are negative,
// constructive/neutral categories score zero.

export const POSITIVE_CATS = new Set(["PRAISE"]);
export const NEGATIVE_CATS = new Set(["BUG", "REMOVE_FEATURE", "PERFORMANCE", "USABILITY"]);

/** +1 positive, -1 negative, 0 neutral/constructive. */
export function sentimentScore(category: string): number {
  if (POSITIVE_CATS.has(category)) return 1;
  if (NEGATIVE_CATS.has(category)) return -1;
  return 0;
}

/** ISO date (YYYY-MM-DD) of the Monday that starts the week containing `d`. */
export function weekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (date.getUTCDay() + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

export interface AComment {
  category: string;
  createdAt: Date;
  userId: string;
  features: { id: string; name: string }[];
}

/** Category / feature / heatmap / over-time / leaderboards / sentiment. */
export function commentAnalytics(comments: AComment[]) {
  const catCount: Record<string, number> = {};
  const featMap = new Map<
    string,
    { id: string; name: string; count: number; byCategory: Record<string, number> }
  >();
  const weekMap = new Map<string, { count: number; sum: number }>();
  const requested = new Map<string, { name: string; count: number }>();
  const bugs = new Map<string, { name: string; count: number }>();
  const praised = new Map<string, { name: string; count: number }>();
  let pos = 0;
  let neg = 0;
  let neu = 0;

  for (const c of comments) {
    catCount[c.category] = (catCount[c.category] ?? 0) + 1;
    const s = sentimentScore(c.category);
    if (s > 0) pos++;
    else if (s < 0) neg++;
    else neu++;

    const wk = weekStart(c.createdAt);
    const w = weekMap.get(wk) ?? { count: 0, sum: 0 };
    w.count++;
    w.sum += s;
    weekMap.set(wk, w);

    for (const f of c.features) {
      const fm = featMap.get(f.id) ?? { id: f.id, name: f.name, count: 0, byCategory: {} };
      fm.count++;
      fm.byCategory[c.category] = (fm.byCategory[c.category] ?? 0) + 1;
      featMap.set(f.id, fm);

      const bump = (m: Map<string, { name: string; count: number }>) => {
        const e = m.get(f.id) ?? { name: f.name, count: 0 };
        e.count++;
        m.set(f.id, e);
      };
      if (c.category === "FEATURE_REQUEST" || c.category === "ENHANCEMENT") bump(requested);
      if (c.category === "BUG") bump(bugs);
      if (c.category === "PRAISE") bump(praised);
    }
  }

  const top = (m: Map<string, { name: string; count: number }>) =>
    [...m.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  return {
    total: comments.length,
    byCategory: Object.entries(catCount)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byFeature: [...featMap.values()].sort((a, b) => b.count - a.count),
    overTime: [...weekMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([week, v]) => ({ week, count: v.count, sentiment: v.count ? v.sum / v.count : 0 })),
    sentiment: { positive: pos, neutral: neu, negative: neg },
    leaderboards: { requested: top(requested), bugs: top(bugs), praised: top(praised) },
  };
}

export interface AQuestion {
  id: string;
  label: string;
  type: string;
  options: any;
}
export interface ASubmission {
  submittedAt: Date;
  answers: Record<string, string | null>;
}

/** Per-question rollups: rating/number stats + NPS-style, yes/no, choice tallies. */
export function questionRollups(questions: AQuestion[], submissions: ASubmission[]) {
  return questions.map((q) => {
    const vals = submissions
      .map((s) => ({ v: s.answers[q.id], at: s.submittedAt }))
      .filter((x) => x.v !== undefined && x.v !== null && x.v !== "") as {
      v: string;
      at: Date;
    }[];
    const base = { id: q.id, label: q.label, type: q.type, responses: vals.length };

    if (q.type === "RATING" || q.type === "NUMBER") {
      const nums = vals.map((x) => Number(x.v)).filter((n) => !Number.isNaN(n));
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      const distribution: Record<string, number> = {};
      for (const n of nums) distribution[n] = (distribution[n] ?? 0) + 1;

      const wk = new Map<string, { sum: number; count: number }>();
      for (const x of vals) {
        const n = Number(x.v);
        if (Number.isNaN(n)) continue;
        const k = weekStart(x.at);
        const e = wk.get(k) ?? { sum: 0, count: 0 };
        e.sum += n;
        e.count++;
        wk.set(k, e);
      }
      const overTime = [...wk.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([week, e]) => ({ week, avg: e.sum / e.count }));

      // NPS-style on a 1–5 rating: 5 = promoter, 4 = passive, ≤3 = detractor.
      let nps: number | null = null;
      if (q.type === "RATING" && nums.length) {
        const prom = nums.filter((n) => n >= 5).length;
        const det = nums.filter((n) => n <= 3).length;
        nps = Math.round(((prom - det) / nums.length) * 100);
      }
      return {
        ...base,
        kind: "numeric" as const,
        avg,
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
        distribution,
        overTime,
        nps,
      };
    }

    if (q.type === "BOOLEAN") {
      const yes = vals.filter((x) => x.v === "true").length;
      const no = vals.filter((x) => x.v === "false").length;
      return { ...base, kind: "boolean" as const, yes, no };
    }

    if (q.type === "SELECT") {
      const tally: Record<string, number> = {};
      for (const x of vals) tally[String(x.v)] = (tally[String(x.v)] ?? 0) + 1;
      const choices: string[] = q.options?.choices ?? [];
      const rows = [...new Set([...choices, ...Object.keys(tally)])].map((choice) => ({
        choice,
        count: tally[choice] ?? 0,
      }));
      return { ...base, kind: "select" as const, tally: rows };
    }

    return { ...base, kind: "text" as const };
  });
}
