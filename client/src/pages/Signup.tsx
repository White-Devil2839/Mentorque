import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import type { User } from "../types";

export function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [experienceLevel, setExperienceLevel] =
    useState<User["experienceLevel"]>("mid");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register({ name, email, password, role, experienceLevel });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap card">
      <h1>Create your profile</h1>
      <p className="sub">Tell us who you're prepping as.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Target job role</label>
          <input
            value={role}
            placeholder="e.g. Backend Engineer"
            onChange={(e) => setRole(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Experience level</label>
          <select
            value={experienceLevel}
            onChange={(e) =>
              setExperienceLevel(e.target.value as User["experienceLevel"])
            }
          >
            <option value="junior">Junior</option>
            <option value="mid">Mid-level</option>
            <option value="senior">Senior</option>
          </select>
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            placeholder="At least 8 characters"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary lg" style={{ width: "100%" }} disabled={busy}>
          {busy ? <span className="spinner" /> : "Create account"}
        </button>
      </form>
      <p className="sub" style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
