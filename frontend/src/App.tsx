import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "@/components/Layout";
import { getToken, getUser, hasModuleAccess, mustChangePassword } from "@/lib/auth";
import ChangePasswordPage from "@/pages/ChangePassword";
import LoginPage from "@/pages/Login";
import TicketInboxPage from "@/pages/ticketing/Inbox";
import TicketDetailPage from "@/pages/ticketing/TicketDetail";
import TicketReportPage from "@/pages/ticketing/Report";
import TeamsPage from "@/pages/ticketing/Teams";
import CategoriesPage from "@/pages/ticketing/Categories";
import RolesPage from "@/pages/admin/Roles";
import UsersPage from "@/pages/admin/Users";
import LoginLogsPage from "@/pages/admin/LoginLogs";

/** Signed in, and holding at least one of the permissions */
function Guard({ children, anyOf }: { children: ReactElement; anyOf: string[] }) {
    if (!getToken() || !getUser()) return <Navigate to="/login" replace />;
    if (!anyOf.some((m) => hasModuleAccess(m))) {
        return <div className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-600 dark:border-white/15 dark:bg-ink-900 dark:text-ink-300">You do not have access to this page. Ask an admin to tick it for your role.</div>;
    }
    return children;
}

/** Checked each time a page opens, so it sees the sign-in that just happened */
function RequireSignIn() {
    if (!getToken()) return <Navigate to="/login" replace />;
    if (mustChangePassword()) return <Navigate to="/change-password" replace />;
    return <Layout />;
}

function Home() {
    const u = getUser();
    if (!getToken() || !u) return <Navigate to="/login" replace />;
    const first = [["/tickets", ["tkt_inbox", "tkt_new", "tkt_my"]], ["/report", ["tkt_report"]], ["/teams", ["tkt_teams"]], ["/categories", ["tkt_categories"]], ["/admin/users", ["adm_users"]]] as const;
    const to = first.find(([, p]) => p.some((m) => hasModuleAccess(m)))?.[0] ?? "/tickets";
    return <Navigate to={to} replace />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={getToken() ? <ChangePasswordPage /> : <Navigate to="/login" replace />} />
            <Route element={<RequireSignIn />}>
                <Route path="/" element={<Home />} />
                <Route path="/tickets" element={<Guard anyOf={["tkt_inbox", "tkt_new", "tkt_my"]}><TicketInboxPage /></Guard>} />
                <Route path="/tickets/:key" element={<Guard anyOf={["tkt_my", "tkt_inbox"]}><TicketDetailPage /></Guard>} />
                <Route path="/report" element={<Guard anyOf={["tkt_report"]}><TicketReportPage /></Guard>} />
                <Route path="/teams" element={<Guard anyOf={["tkt_teams"]}><TeamsPage /></Guard>} />
                <Route path="/categories" element={<Guard anyOf={["tkt_categories"]}><CategoriesPage /></Guard>} />
                <Route path="/admin/roles" element={<Guard anyOf={["adm_roles"]}><RolesPage /></Guard>} />
                <Route path="/admin/users" element={<Guard anyOf={["adm_users"]}><UsersPage /></Guard>} />
                <Route path="/admin/login-logs" element={<Guard anyOf={["adm_logs"]}><LoginLogsPage /></Guard>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
