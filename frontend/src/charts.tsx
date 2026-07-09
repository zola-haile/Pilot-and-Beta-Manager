// Small, dependency-free chart primitives (inline SVG / CSS) for the analytics
// dashboard. Everything is self-contained so there are no external chart libs.

export function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

export function BarList({
  items,
  formatValue,
  emptyText = "No data yet.",
}: {
  items: BarItem[];
  formatValue?: (v: number) => string;
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="muted" style={{ fontSize: 13 }}>{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="barlist">
      {items.map((it, i) => (
        <div className="barlist-row" key={i}>
          <div className="barlist-label" title={it.label}>
            {it.label}
          </div>
          <div className="barlist-track">
            <div
              className="barlist-fill"
              style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? "var(--primary)" }}
            />
          </div>
          <div className="barlist-value">{it.hint ?? (formatValue ? formatValue(it.value) : it.value)}</div>
        </div>
      ))}
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 140,
  stroke = 22,
  centerLabel,
  centerSub,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - stroke / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total === 0 ? (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          ) : (
            segments
              .filter((s) => s.value > 0)
              .map((s, i) => {
                const dash = (s.value / total) * circ;
                const el = (
                  <circle
                    key={i}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={stroke}
                    strokeDasharray={`${dash} ${circ - dash}`}
                    strokeDashoffset={-acc}
                  />
                );
                acc += dash;
                return el;
              })
          )}
        </g>
        {centerLabel !== undefined && (
          <text x="50%" y="47%" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)">
            {centerLabel}
          </text>
        )}
        {centerSub && (
          <text x="50%" y="62%" textAnchor="middle" fontSize="11" fill="var(--muted)">
            {centerSub}
          </text>
        )}
      </svg>
      <div className="stack" style={{ gap: 6 }}>
        {segments.map((s, i) => (
          <div className="row" key={i} style={{ gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
            <span>{s.label}</span>
            <b>{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface HeatColumn {
  key: string;
  label: string;
  color?: string;
}
export interface HeatRow {
  label: string;
  cells: Record<string, number>;
  total: number;
}

export function Heatmap({ columns, rows }: { columns: HeatColumn[]; rows: HeatRow[] }) {
  if (rows.length === 0 || columns.length === 0)
    return <p className="muted" style={{ fontSize: 13 }}>No feature-tagged comments yet.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => columns.map((c) => r.cells[c.key] ?? 0)));
  return (
    <div className="table-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th></th>
            {columns.map((c) => (
              <th key={c.key} title={c.label}>
                <span className="heat-coltag" style={{ background: c.color ?? "#6b7280" }} />
                {c.label}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="heat-rowlabel" title={r.label}>
                {r.label}
              </td>
              {columns.map((c) => {
                const v = r.cells[c.key] ?? 0;
                const alpha = v === 0 ? 0 : 0.12 + 0.75 * (v / max);
                return (
                  <td
                    key={c.key}
                    className="heat-cell"
                    style={{ background: v ? `rgba(79,70,229,${alpha})` : undefined, color: alpha > 0.6 ? "#fff" : undefined }}
                  >
                    {v || ""}
                  </td>
                );
              })}
              <td className="heat-cell" style={{ fontWeight: 700 }}>
                {r.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Volume bars + a sentiment line (−1..1) over the same weekly x-axis.
export function TrendChart({
  weeks,
}: {
  weeks: { week: string; count: number; sentiment: number }[];
}) {
  if (weeks.length === 0) return <p className="muted" style={{ fontSize: 13 }}>No comments yet.</p>;
  const W = 640;
  const H = 160;
  const padB = 24;
  const padT = 10;
  const maxCount = Math.max(1, ...weeks.map((w) => w.count));
  const n = weeks.length;
  const bw = (W / n) * 0.6;
  const xAt = (i: number) => (W / n) * (i + 0.5);
  const yCount = (c: number) => padT + (1 - c / maxCount) * (H - padT - padB);
  const ySent = (s: number) => padT + (1 - (s + 1) / 2) * (H - padT - padB);
  const line = weeks.map((w, i) => `${xAt(i)},${ySent(w.sentiment)}`).join(" ");
  return (
    <div>
      <div className="table-wrap">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ maxWidth: "100%" }}>
          {/* sentiment zero baseline */}
          <line x1="0" x2={W} y1={ySent(0)} y2={ySent(0)} stroke="#e5e7eb" strokeDasharray="4 4" />
          {weeks.map((w, i) => (
            <rect
              key={i}
              x={xAt(i) - bw / 2}
              y={yCount(w.count)}
              width={bw}
              height={H - padB - yCount(w.count)}
              fill="#c7d2fe"
              rx="2"
            />
          ))}
          <polyline points={line} fill="none" stroke="#4f46e5" strokeWidth="2" />
          {weeks.map((w, i) => (
            <circle key={i} cx={xAt(i)} cy={ySent(w.sentiment)} r="3" fill="#4f46e5" />
          ))}
          {weeks.map((w, i) => (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--muted)">
              {w.week.slice(5)}
            </text>
          ))}
        </svg>
      </div>
      <div className="row" style={{ gap: 16, fontSize: 12, marginTop: 4 }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, background: "#c7d2fe", display: "inline-block", borderRadius: 2 }} /> volume
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 2, background: "#4f46e5", display: "inline-block" }} /> sentiment (−1…+1)
        </span>
      </div>
    </div>
  );
}

// A simple average-over-time line (e.g. rating trend).
export function LineTrend({
  points,
  yMin = 1,
  yMax = 5,
  color = "#4f46e5",
}: {
  points: { label: string; y: number }[];
  yMin?: number;
  yMax?: number;
  color?: string;
}) {
  if (points.length === 0) return <p className="muted" style={{ fontSize: 13 }}>No data yet.</p>;
  const W = 640;
  const H = 140;
  const padB = 22;
  const padT = 10;
  const n = points.length;
  const xAt = (i: number) => (n === 1 ? W / 2 : (W / (n - 1)) * i);
  const yAt = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const line = points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ");
  return (
    <div className="table-wrap">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ maxWidth: "100%" }}>
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r="3" fill={color} />
        ))}
        {points.map((p, i) => (
          <text key={i} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {p.label.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}
