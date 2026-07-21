import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner } from "../components";
import { categoryColor, categoryLabel, SENTIMENT_COLORS } from "../categories";
import { BarList, Donut, Heatmap, LineTrend, StatCard, TrendChart } from "../charts";

/* -------------------------------- Types ------------------------------- */

interface NamedCount {
  name: string;
  count: number;
}
interface FeatureAgg {
  id: string;
  name: string;
  count: number;
  byCategory: Record<string, number>;
}
interface CompanyAgg {
  company: string;
  participants: number;
  active: number;
  participationRate: number;
  comments: number;
  positive: number;
  negative: number;
}
type QuestionRollup =
  | {
      id: string;
      label: string;
      type: string;
      responses: number;
      kind: "numeric";
      avg: number | null;
      min: number | null;
      max: number | null;
      distribution: Record<string, number>;
      overTime: { week: string; avg: number }[];
      nps: number | null;
    }
  | { id: string; label: string; type: string; responses: number; kind: "boolean"; yes: number; no: number }
  | {
      id: string;
      label: string;
      type: string;
      responses: number;
      kind: "select";
      tally: { choice: string; count: number }[];
    }
  | { id: string; label: string; type: string; responses: number; kind: "text" };

interface AnalyticsData {
  scope: "app" | "pilot";
  totals: { comments: number; open: number; participants: number; responses: number; pilots?: number };
  byCategory: { category: string; count: number }[];
  byFeature: FeatureAgg[];
  overTime: { week: string; count: number; sentiment: number }[];
  sentiment: { positive: number; neutral: number; negative: number };
  leaderboards: { requested: NamedCount[]; bugs: NamedCount[]; praised: NamedCount[] };
  byCompany: CompanyAgg[];
  questions?: QuestionRollup[];
  ratings?: {
    average: number | null;
    count: number;
    overTime: { week: string; avg: number }[];
    byPilot: { pilot: string; avg: number; count: number }[];
  };
}

/* ----------------------------- Route wrappers ------------------------- */

export function AppAnalyticsPage() {
  const { appId } = useParams();
  const [appName, setAppName] = useState("");
  useEffect(() => {
    api<{ application: { name: string } }>(`/applications/${appId}`)
      .then((r) => setAppName(r.application.name))
      .catch(() => {});
  }, [appId]);
  return (
    <AnalyticsLayout
      back={{ to: `/applications/${appId}`, label: "← Back to application" }}
      title={`Analytics${appName ? ` · ${appName}` : ""}`}
      subtitle="Across every pilot in this project."
      fetchPath={`/applications/${appId}/analytics`}
    />
  );
}

export function PilotAnalyticsPage() {
  const { id } = useParams();
  const [pilotName, setPilotName] = useState("");
  useEffect(() => {
    api<{ pilot: { name: string } }>(`/pilots/${id}`)
      .then((r) => setPilotName(r.pilot.name))
      .catch(() => {});
  }, [id]);
  return (
    <AnalyticsLayout
      back={{ to: `/pilots/${id}`, label: "← Back to pilot" }}
      title={`Analytics${pilotName ? ` · ${pilotName}` : ""}`}
      subtitle="This pilot's feedback and responses."
      fetchPath={`/pilots/${id}/analytics`}
    />
  );
}

function AnalyticsLayout({
  back,
  title,
  subtitle,
  fetchPath,
}: {
  back: { to: string; label: string };
  title: string;
  subtitle: string;
  fetchPath: string;
}) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AnalyticsData>(fetchPath)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [fetchPath]);

  return (
    <Layout>
      <Link to={back.to} className="muted" style={{ fontSize: 14 }}>
        {back.label}
      </Link>
      <h1 style={{ margin: "10px 0 2px" }}>{title}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {subtitle}
      </p>
      {error ? (
        <div className="alert alert-error">{error}</div>
      ) : !data ? (
        <Spinner />
      ) : (
        <Dashboard data={data} />
      )}
    </Layout>
  );
}

/* ------------------------------ Dashboard ----------------------------- */

function Dashboard({ data }: { data: AnalyticsData }) {
  const net = data.sentiment.positive - data.sentiment.negative;
  const categoriesPresent = data.byCategory.map((c) => c.category);

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Stat cards */}
      <div className="stat-cards">
        <StatCard label="Comments" value={data.totals.comments} sub={`${data.totals.open} open`} />
        <StatCard label="Responses" value={data.totals.responses} />
        <StatCard label="Participants" value={data.totals.participants} />
        {data.scope === "app" && data.totals.pilots !== undefined && (
          <StatCard label="Pilots with data" value={data.totals.pilots} />
        )}
        <StatCard
          label="Net sentiment"
          value={<span style={{ color: net > 0 ? SENTIMENT_COLORS.positive : net < 0 ? SENTIMENT_COLORS.negative : undefined }}>{net > 0 ? `+${net}` : net}</span>}
          sub={`${data.sentiment.positive}▲ ${data.sentiment.negative}▼`}
        />
      </div>

      {/* Sentiment + category */}
      <div className="grid-2">
        <div className="card">
          <h2>Sentiment</h2>
          <Donut
            segments={[
              { label: "Positive", value: data.sentiment.positive, color: SENTIMENT_COLORS.positive },
              { label: "Neutral", value: data.sentiment.neutral, color: SENTIMENT_COLORS.neutral },
              { label: "Negative", value: data.sentiment.negative, color: SENTIMENT_COLORS.negative },
            ]}
            centerLabel={String(data.totals.comments)}
            centerSub="comments"
          />
        </div>
        <div className="card">
          <h2>By type</h2>
          <BarList
            items={data.byCategory.map((c) => ({
              label: categoryLabel(c.category),
              value: c.count,
              color: categoryColor(c.category),
            }))}
          />
        </div>
      </div>

      {/* Over time */}
      <div className="card">
        <h2>Feedback over time</h2>
        <TrendChart weeks={data.overTime} />
      </div>

      {/* By feature + heatmap */}
      <div className="card">
        <h2>By feature</h2>
        <BarList items={data.byFeature.map((f) => ({ label: f.name, value: f.count }))} emptyText="No feature-tagged comments yet." />
        {data.byFeature.length > 0 && (
          <>
            <h3 style={{ margin: "18px 0 10px" }}>Feature × type heatmap</h3>
            <Heatmap
              columns={categoriesPresent.map((c) => ({ key: c, label: categoryLabel(c), color: categoryColor(c) }))}
              rows={data.byFeature.map((f) => ({ label: f.name, cells: f.byCategory, total: f.count }))}
            />
          </>
        )}
      </div>

      {/* Leaderboards */}
      <div className="grid-3">
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Top requests</h3>
          <BarList items={data.leaderboards.requested.map((x) => ({ label: x.name, value: x.count, color: categoryColor("FEATURE_REQUEST") }))} emptyText="No requests yet." />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Most-reported bugs</h3>
          <BarList items={data.leaderboards.bugs.map((x) => ({ label: x.name, value: x.count, color: categoryColor("BUG") }))} emptyText="No bugs reported." />
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Most praised</h3>
          <BarList items={data.leaderboards.praised.map((x) => ({ label: x.name, value: x.count, color: categoryColor("PRAISE") }))} emptyText="No praise yet." />
        </div>
      </div>

      {/* By company */}
      <div className="card">
        <h2>By company</h2>
        {data.byCompany.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No companies yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="feedback-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Participation</th>
                  <th>Comments</th>
                  <th>Tone</th>
                </tr>
              </thead>
              <tbody>
                {data.byCompany.map((c) => (
                  <tr key={c.company}>
                    <td>
                      <b>{c.company}</b>
                    </td>
                    <td style={{ minWidth: 180 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="barlist-track" style={{ flex: 1 }}>
                          <div
                            className="barlist-fill"
                            style={{ width: `${Math.round(c.participationRate * 100)}%`, background: "var(--primary)" }}
                          />
                        </div>
                        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {c.active}/{c.participants} ({Math.round(c.participationRate * 100)}%)
                        </span>
                      </div>
                    </td>
                    <td>{c.comments}</td>
                    <td>
                      {c.positive > 0 && <span className="badge" style={{ background: "#ecfdf5", color: SENTIMENT_COLORS.positive }}>{c.positive}▲</span>}{" "}
                      {c.negative > 0 && <span className="badge" style={{ background: "#fef2f2", color: SENTIMENT_COLORS.negative }}>{c.negative}▼</span>}
                      {c.positive === 0 && c.negative === 0 && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Structured answers */}
      {data.scope === "pilot" && data.questions && (
        <div className="card">
          <h2>Response rollups</h2>
          {data.questions.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>This pilot has no questions.</p>
          ) : (
            <div className="stack" style={{ gap: 18 }}>
              {data.questions.map((q) => (
                <QuestionRollupCard key={q.id} q={q} />
              ))}
            </div>
          )}
        </div>
      )}
      {data.scope === "app" && data.ratings && (
        <div className="card">
          <h2>Ratings across pilots</h2>
          {data.ratings.count === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No rating answers collected yet.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
                <StatCard label="Overall average" value={`${data.ratings.average!.toFixed(1)} / 5`} sub={`${data.ratings.count} ratings`} />
              </div>
              <h3 style={{ margin: "6px 0 8px" }}>Average by pilot</h3>
              <BarList
                items={data.ratings.byPilot.map((p) => ({
                  label: p.pilot,
                  value: p.avg,
                  hint: `${p.avg.toFixed(1)} (${p.count})`,
                }))}
              />
              <h3 style={{ margin: "16px 0 8px" }}>Average over time</h3>
              <LineTrend points={data.ratings.overTime.map((o) => ({ label: o.week, y: o.avg }))} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionRollupCard({ q }: { q: QuestionRollup }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div className="spread">
        <b>{q.label}</b>
        <span className="muted" style={{ fontSize: 13 }}>
          {q.responses} {q.responses === 1 ? "response" : "responses"}
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        {q.kind === "numeric" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
              <StatCard label={q.type === "RATING" ? "Average" : "Average"} value={q.avg !== null ? (q.type === "RATING" ? `${q.avg.toFixed(1)} / 5` : q.avg.toFixed(1)) : "—"} />
              {q.type === "RATING" && q.nps !== null && (
                <StatCard label="NPS-style" value={q.nps > 0 ? `+${q.nps}` : q.nps} sub="promoters − detractors" />
              )}
              {q.min !== null && <StatCard label="Range" value={`${q.min}–${q.max}`} />}
            </div>
            <BarList
              items={Object.entries(q.distribution)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([k, v]) => ({ label: k, value: v }))}
              emptyText="No numeric answers."
            />
            {q.overTime.length > 1 && (
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  Average over time
                </div>
                <LineTrend
                  points={q.overTime.map((o) => ({ label: o.week, y: o.avg }))}
                  yMin={q.type === "RATING" ? 1 : Math.min(...q.overTime.map((o) => o.avg))}
                  yMax={q.type === "RATING" ? 5 : Math.max(...q.overTime.map((o) => o.avg), 1)}
                />
              </div>
            )}
          </div>
        )}
        {q.kind === "boolean" && (
          <BarList
            items={[
              { label: "Yes", value: q.yes, color: SENTIMENT_COLORS.positive },
              { label: "No", value: q.no, color: SENTIMENT_COLORS.negative },
            ]}
          />
        )}
        {q.kind === "select" && (
          <BarList items={q.tally.map((t) => ({ label: t.choice, value: t.count }))} emptyText="No selections." />
        )}
        {q.kind === "text" && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {q.responses} free-text {q.responses === 1 ? "answer" : "answers"} (see the Responses list on the pilot).
          </p>
        )}
      </div>
    </div>
  );
}
