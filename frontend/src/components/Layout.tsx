import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import axios from "axios";
import { BarChart3, History, Inbox, LogOut, Moon, ShieldCheck, Sun, Tags, Ticket, Users, UsersRound } from "lucide-react";
import { cn } from "@heroui/theme";

import { clearSession, getUser, hasModuleAccess, refreshUser } from "@/lib/auth";

const MENU = [
    { to: "/tickets", label: "Tickets", icon: Inbox, anyOf: ["tkt_inbox", "tkt_new", "tkt_my"] },
    { to: "/report", label: "Report", icon: BarChart3, anyOf: ["tkt_report"] },
    { to: "/teams", label: "Teams", icon: UsersRound, anyOf: ["tkt_teams"] },
    { to: "/categories", label: "Ticket categories", icon: Tags, anyOf: ["tkt_categories"] },
    { group: "Administration" },
    { to: "/admin/roles", label: "Roles", icon: ShieldCheck, anyOf: ["adm_roles"] },
    { to: "/admin/users", label: "Users", icon: Users, anyOf: ["adm_users"] },
    { to: "/admin/login-logs", label: "Login logs", icon: History, anyOf: ["adm_logs"] },
] as const;

type Item = { to: string; label: string; icon: typeof Inbox; anyOf: readonly string[] } | { group: string };

export default function Layout() {
    const navigate = useNavigate();
    const [user, setUser] = useState(getUser());
    const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
    // a role may have changed since sign-in
    useEffect(() => { void refreshUser().then(setUser); }, []);

    const signOut = async () => { try { await axios.post("/api/auth/logout"); } catch { /* signing out anyway */ } clearSession(); navigate("/login", { replace: true }); };
    const toggleTheme = () => { const next = !dark; document.documentElement.classList.toggle("dark", next); try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* ignore */ } setDark(next); };

    const items = (MENU as readonly Item[]).filter((m, i, all) => {
        if ("group" in m) return all.slice(i + 1).some((n) => "anyOf" in n && n.anyOf.some((p) => hasModuleAccess(p)));
        return m.anyOf.some((p) => hasModuleAccess(p));
    });

    return (
        <div className="flex min-h-screen bg-ink-50 dark:bg-ink-950">
            <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900">
                <div className="flex items-center gap-2 px-5 py-5"><Ticket className="text-brand-600" size={20} /><span className="font-extrabold tracking-wide">TICKETING</span></div>
                <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3" aria-label="Main">
                    {items.map((m) => "group" in m
                        ? <p key={m.group} className="eyebrow mt-4 px-2 pb-1">{m.group}</p>
                        : (
                            <NavLink key={m.to} to={m.to} className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors",
                                isActive ? "bg-brand-50 font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5")}>
                                <m.icon size={16} />{m.label}
                            </NavLink>
                        ))}
                </nav>
                <div className="flex items-center gap-2 border-t border-ink-200 p-3 dark:border-white/10">
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{user?.name}</p><p className="truncate text-xs text-ink-500">{user?.email}</p></div>
                    <button type="button" aria-label="Switch theme" onClick={toggleTheme} className="p-2 text-ink-500 hover:text-ink-900 dark:hover:text-white">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
                    <button type="button" aria-label="Sign out" onClick={signOut} className="p-2 text-ink-500 hover:text-rose-600"><LogOut size={16} /></button>
                </div>
            </aside>
            <main className="min-w-0 flex-1 p-6 lg:p-8"><Outlet /></main>
        </div>
    );
}
