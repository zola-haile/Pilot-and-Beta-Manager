import { ReactNode, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { api } from "./api";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function resend() {
    setState("sending");
    try {
      await api("/auth/resend-verification", { method: "POST", auth: false, body: { email } });
    } finally {
      setState("sent");
    }
  }
  return (
    <div className="verify-banner">
      Your email isn't verified yet — verify it to unlock invitations and admin access.{" "}
      {state === "sent" ? (
        <b>Link sent — check your inbox.</b>
      ) : (
        <button className="linkish" disabled={state === "sending"} onClick={resend}>
          Resend verification link
        </button>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <div className="topbar">
        <div className="row" style={{ gap: 24 }}>
          <Link to="/" className="brand">
            🚀 Pilot Manager
          </Link>
          {user?.role === "PM" && (
            <nav className="row" style={{ gap: 16 }}>
              <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-active" : "nav-link")}>
                Projects
              </NavLink>
              <NavLink to="/companies" className={({ isActive }) => (isActive ? "nav-active" : "nav-link")}>
                Companies
              </NavLink>
            </nav>
          )}
          {user?.role === "COMPANY_ADMIN" && (
            <nav className="row" style={{ gap: 16 }}>
              <NavLink to="/admin" className={({ isActive }) => (isActive ? "nav-active" : "nav-link")}>
                Admin
              </NavLink>
              <NavLink to="/piloting" className={({ isActive }) => (isActive ? "nav-active" : "nav-link")}>
                Piloting view
              </NavLink>
            </nav>
          )}
        </div>
        {user && (
          <div className="row">
            <span className="muted">
              {user.name ?? user.email}
              {user.role === "PM" ? " · PM" : ""}
            </span>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
      {user && !user.emailVerified && <VerifyBanner email={user.email} />}
      <div className="container">{children}</div>
    </>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="empty">{label}</div>;
}
