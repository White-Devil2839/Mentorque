import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Dashboard } from "./pages/Dashboard";
import { NewInterview } from "./pages/NewInterview";
import { InterviewRoom } from "./pages/InterviewRoom";
import { ReportPage } from "./pages/Report";

function Protected({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();
  if (!ready) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="nav">
      <Link to="/" className="brand">
        Mentor<span>que</span>
      </Link>
      {user && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 14 }}>
            {user.name}
          </span>
          <Link className="btn" to="/new">
            New interview
          </Link>
          <button
            className="btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { token, ready } = useAuth();
  if (!ready) return null;

  return (
    <>
      <Nav />
      <Routes>
        <Route
          path="/login"
          element={token ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/signup"
          element={token ? <Navigate to="/" replace /> : <Signup />}
        />
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/new"
          element={
            <Protected>
              <NewInterview />
            </Protected>
          }
        />
        <Route
          path="/interview/:id"
          element={
            <Protected>
              <InterviewRoom />
            </Protected>
          }
        />
        <Route
          path="/report/:id"
          element={
            <Protected>
              <ReportPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
