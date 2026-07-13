import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Spinner } from "./components";
import { LoginPage, RegisterPage, VerifyEmailPage } from "./pages/Auth";
import { ApplicationsListPage, ApplicationDetailPage } from "./pages/Applications";
import { FeedbackPage } from "./pages/Feedback";
import { AppAnalyticsPage, PilotAnalyticsPage } from "./pages/Analytics";
import { CompaniesPage, CompanyDetailPage } from "./pages/Companies";
import { PilotDetailPage } from "./pages/PilotDetail";
import { InviteAcceptPage } from "./pages/InviteAccept";
import { ParticipantHomePage } from "./pages/ParticipantHome";
import { ParticipantFormPage } from "./pages/ParticipantForm";
import { AdminAcceptPage } from "./pages/AdminAccept";
import { AdminOverviewPage } from "./pages/AdminOverview";
import { AdminParticipationPage } from "./pages/AdminParticipation";
import { JoinPage } from "./pages/Join";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Sends signed-in users to the right home based on role.
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "PM") return <ApplicationsListPage />;
  if (user.role === "COMPANY_ADMIN") return <Navigate to="/admin" replace />;
  return <ParticipantHomePage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify/:token" element={<VerifyEmailPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/admin/accept/:token" element={<AdminAcceptPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminOverviewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/participations/:pcId"
        element={
          <RequireAuth>
            <AdminParticipationPage />
          </RequireAuth>
        }
      />
      <Route
        path="/piloting"
        element={
          <RequireAuth>
            <ParticipantHomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/applications/:appId"
        element={
          <RequireAuth>
            <ApplicationDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/applications/:appId/feedback"
        element={
          <RequireAuth>
            <FeedbackPage />
          </RequireAuth>
        }
      />
      <Route
        path="/applications/:appId/analytics"
        element={
          <RequireAuth>
            <AppAnalyticsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/companies"
        element={
          <RequireAuth>
            <CompaniesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/companies/:id"
        element={
          <RequireAuth>
            <CompanyDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/pilots/:id"
        element={
          <RequireAuth>
            <PilotDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/pilots/:id/analytics"
        element={
          <RequireAuth>
            <PilotAnalyticsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/participate/:id"
        element={
          <RequireAuth>
            <ParticipantFormPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
