import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Layout, Spinner, StatusBadge } from "../components";

interface MyPilot {
  id: string;
  name: string;
  description: string | null;
  status: string;
  questionCount: number;
  entryCount: number;
}

export function ParticipantHomePage() {
  const [pilots, setPilots] = useState<MyPilot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ pilots: MyPilot[] }>("/my/pilots")
      .then((r) => setPilots(r.pilots))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <Layout>
      <h1>Your pilots</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Programs you've been invited to take part in.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {!pilots ? (
        <Spinner />
      ) : pilots.length === 0 ? (
        <div className="card empty">You haven't been invited to any pilots yet.</div>
      ) : (
        <div className="stack">
          {pilots.map((p) => (
            <Link key={p.id} to={`/participate/${p.id}`} className="card card-link">
              <div className="spread">
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <div className="row">
                  {p.entryCount > 0 && (
                    <span className="badge badge-accepted">
                      {p.entryCount} {p.entryCount === 1 ? "entry" : "entries"}
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                </div>
              </div>
              {p.description && (
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  {p.description}
                </p>
              )}
              <div className="stat-grid">
                <span className="stat">
                  <b>{p.questionCount}</b> questions to answer
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
