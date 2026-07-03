import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { User } from "./types";

interface RegisterPayload {
  email: string;
  password: string;
  name: string;
  role: string;
  experienceLevel: User["experienceLevel"];
}

interface AuthValue {
  user: User | null;
  token: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

const TOKEN_KEY = "mq_token";
const USER_KEY = "mq_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    const u = localStorage.getItem(USER_KEY);
    if (t && u) {
      setToken(t);
      try {
        setUser(JSON.parse(u));
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, []);

  function persist(t: string, u: User) {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
  }

  async function login(email: string, password: string) {
    const { token: t, user: u } = await api<{ token: string; user: User }>(
      "/auth/login",
      { method: "POST", body: { email, password } },
    );
    persist(t, u);
  }

  async function register(payload: RegisterPayload) {
    const { token: t, user: u } = await api<{ token: string; user: User }>(
      "/auth/register",
      { method: "POST", body: payload },
    );
    persist(t, u);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, token, ready, login, register, logout }),
    [user, token, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
