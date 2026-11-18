import axios from "axios";

export type Action = "read" | "create" | "update" | "delete";
export interface SessionUser { userId: number; name: string; email: string; privileges: Record<string, Action[]> }

const TOKEN = "tt_token";
const USER = "tt_user";
const MCP = "tt_mcp";

export const getToken = () => { try { return localStorage.getItem(TOKEN); } catch { return null; } };
export const getUser = (): SessionUser | null => { try { const t = localStorage.getItem(USER); return t ? (JSON.parse(t) as SessionUser) : null; } catch { return null; } };

export function saveSession(token: string, user: SessionUser, mustChangePassword = false) {
    try { localStorage.setItem(TOKEN, token); localStorage.setItem(USER, JSON.stringify(user)); localStorage.setItem(MCP, mustChangePassword ? "1" : ""); } catch { /* storage blocked */ }
}
/** True while the person is still on a temporary password */
export const mustChangePassword = () => { try { return localStorage.getItem(MCP) === "1"; } catch { return false; } };
export function clearSession() { try { localStorage.removeItem(TOKEN); localStorage.removeItem(USER); localStorage.removeItem(MCP); } catch { /* ignore */ } }

/** True when the signed-in role ticks `action` on `module` (read is the default) */
export function hasModuleAccess(module: string, action: Action = "read"): boolean {
    return !!getUser()?.privileges?.[module]?.includes(action);
}

/** Adds the sign-in token to every call and returns to the login page when it is no longer valid */
export function installApiAuth() {
    axios.interceptors.request.use((cfg) => { const t = getToken(); if (t) cfg.headers.Authorization = `Bearer ${t}`; return cfg; });
    axios.interceptors.response.use((r) => r, (err) => {
        const url = String(err?.config?.url ?? "");
        if (err?.response?.status === 401 && !url.includes("/auth/login") && !url.includes("/auth/verify-otp") && getToken()) { clearSession(); window.location.assign("/login"); }
        if (err?.response?.status === 403 && err?.response?.data?.code === "PASSWORD_CHANGE_REQUIRED" && !window.location.pathname.startsWith("/change-password")) window.location.assign("/change-password");
        return Promise.reject(err);
    });
}

/** Refreshes the stored permissions from the server (a role may have changed since sign-in) */
export async function refreshUser(): Promise<SessionUser | null> {
    try {
        const r = await axios.get("/api/auth/me");
        const u = r.data.response as SessionUser;
        const t = getToken();
        if (t) saveSession(t, u, mustChangePassword());
        return u;
    } catch { return getUser(); }
}
