import { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
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
                Applications
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
      <div className="container">{children}</div>
    </>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="empty">{label}</div>;
}
