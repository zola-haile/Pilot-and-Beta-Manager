import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";

interface Participation {
  id: string;
  company: { id: string; name: string };
  pilot: { id: string; name: string; description: string | null; status: string };
  participantCount: number;
  shareUrl: string;
}

export function AdminOverviewPage() {
  const [participations, setParticipations] = useState<Participation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ participations: Participation[] }>("/admin/participations")
      .then((r) => setParticipations(r.participations))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <Layout>
      <h1>Admin dashboard</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Pilots your companies have been added to. Open one to invite your team.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!participations ? (
        <Spinner />
      ) : participations.length === 0 ? (
        <div className="card empty">
          Your companies haven't been added to any pilots yet. You'll get an email when they are.
        </div>
      ) : (
        <div className="stack">
          {participations.map((p) => (
            <Link key={p.id} to={`/admin/participations/${p.id}`} className="card card-link">
              <div className="spread">
                <div>
                  <h2 style={{ margin: 0 }}>{p.pilot.name}</h2>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {p.company.name}
                  </div>
                </div>
                <StatusBadge status={p.pilot.status} />
              </div>
              {p.pilot.description && (
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {p.pilot.description}
                </p>
              )}
              <div className="stat-grid">
                <span className="stat">
                  <b>{p.participantCount}</b>{" "}
                  {p.participantCount === 1 ? "person invited" : "people invited"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
