import { useEffect, useState } from "react";
import axios from "axios";
import { format } from "date-fns";

import { PageHeader, Panel, SummaryBar } from "@/components/page";
import { Button, Input, Select, SelectItem, addToast } from "@/components/ui";

interface Log { id: number; at: string; event: string; email: string; name: string | null; detail: string | null; ip: string | null; device: string | null }
interface Result { total: number; page: number; size: number; last7Days: { signedIn: number; failed: number; locked: number }; logs: Log[] }
const EVENTS: { key: string; label: string; tone: string }[] = [
    { key: "LOGIN_OK", label: "Signed in", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { key: "OTP_SENT", label: "Code sent", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
    { key: "PASSWORD_FAILED", label: "Wrong password", tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
    { key: "OTP_FAILED", label: "Wrong code", tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
    { key: "LOCKED", label: "Locked out", tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
    { key: "LOGOUT", label: "Signed out", tone: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-ink-200" },
];
const ALL = "_all";
const day = (d: Date) => d.toISOString().slice(0, 10);
const browser = (ua: string | null) => {
    if (!ua) return "";
    const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
    const os = /Windows/.test(ua) ? " on Windows" : /Mac OS/.test(ua) ? " on Mac" : /Android/.test(ua) ? " on Android" : /iPhone|iPad/.test(ua) ? " on iOS" : /Linux/.test(ua) ? " on Linux" : "";
    return b + os;
};

/** Every sign-in attempt: who, what happened, when, from which address and browser. */
export default function LoginLogsPage() {
    const [event, setEvent] = useState("");
    const [q, setQ] = useState(""); const [qLive, setQLive] = useState("");
    const [from, setFrom] = useState(day(new Date(Date.now() - 6 * 86_400_000)));
    const [to, setTo] = useState(day(new Date()));
    const [page, setPage] = useState(1);
    const [r, setR] = useState<Result | null>(null);

    useEffect(() => { const t = setTimeout(() => { setQ(qLive); setPage(1); }, 400); return () => clearTimeout(t); }, [qLive]);
    useEffect(() => {
        axios.get("/api/admin/login-logs", { params: { event: event || undefined, email: q || undefined, from, to, page, size: 50 } }).then((x) => setR(x.data.response))
            .catch((e) => addToast({ title: "Could not load the logs", description: e?.response?.data?.message ?? e.message, color: "danger" }));
    }, [event, q, from, to, page]);

    const tone = (k: string) => EVENTS.find((e) => e.key === k);
    const pages = r ? Math.max(1, Math.ceil(r.total / r.size)) : 1;

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Login logs" subtitle="Every sign-in attempt, newest first. Five wrong passwords or codes lock the email for 15 minutes." />
            {r && <SummaryBar className="mb-0" items={[{ label: "Signed in (7 days)", value: r.last7Days.signedIn }, { label: "Failed attempts (7 days)", value: r.last7Days.failed }, { label: "Lock-outs (7 days)", value: r.last7Days.locked }, { label: "Matching this filter", value: r.total }]} />}
            <Panel>
                <div className="flex flex-wrap items-end gap-3">
                    <Input type="date" size="sm" className="w-40" label="From" labelPlacement="outside" value={from} max={to} onValueChange={(v) => { if (v) { setFrom(v); setPage(1); } }} />
                    <Input type="date" size="sm" className="w-40" label="To" labelPlacement="outside" value={to} min={from} onValueChange={(v) => { if (v) { setTo(v); setPage(1); } }} />
                    <Select size="sm" className="w-48" label="What happened" labelPlacement="outside" selectedKeys={new Set([event || ALL])} onSelectionChange={(k) => { const v = String(Array.from(k)[0] ?? ALL); setEvent(v === ALL ? "" : v); setPage(1); }}>
                        {[{ key: ALL, label: "Everything" }, ...EVENTS].map((e) => <SelectItem key={e.key}>{e.label}</SelectItem>)}
                    </Select>
                    <Input size="sm" className="w-64" label="Person or email" labelPlacement="outside" placeholder="Search" value={qLive} onValueChange={setQLive} />
                </div>
            </Panel>
            <Panel>
                {!r ? <p className="text-sm text-ink-500">Loading…</p> : !r.logs.length ? <p className="text-sm text-ink-500">Nothing matches this filter.</p> : (
                    <div className="overflow-x-auto"><table className="w-full text-sm">
                        <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-500"><th className="py-2 font-semibold">When</th><th className="py-2 font-semibold">What happened</th><th className="py-2 font-semibold">Person</th><th className="py-2 font-semibold">Details</th><th className="py-2 font-semibold">From</th></tr></thead>
                        <tbody>{r.logs.map((l) => (
                            <tr key={l.id} className="border-t border-ink-100 align-top dark:border-white/5">
                                <td className="whitespace-nowrap py-2.5 tabular-nums">{format(new Date(l.at), "dd MMM yyyy, HH:mm:ss")}</td>
                                <td className="py-2.5"><span className={`px-2 py-0.5 text-xs font-bold ${tone(l.event)?.tone ?? ""}`}>{tone(l.event)?.label ?? l.event}</span></td>
                                <td className="py-2.5"><p className="font-medium">{l.name ?? "Unknown"}</p><p className="text-xs text-ink-500">{l.email}</p></td>
                                <td className="py-2.5 text-ink-600 dark:text-ink-300">{l.detail ?? ""}</td>
                                <td className="py-2.5 text-xs text-ink-500"><p>{l.ip}</p><p>{browser(l.device)}</p></td>
                            </tr>))}</tbody>
                    </table></div>
                )}
                {r && r.total > r.size && (
                    <div className="mt-4 flex items-center justify-between text-sm">
                        <span className="text-ink-500">Page {page} of {pages}</span>
                        <div className="flex gap-2"><Button size="sm" variant="bordered" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="bordered" isDisabled={page >= pages} onPress={() => setPage(page + 1)}>Next</Button></div>
                    </div>
                )}
            </Panel>
        </div>
    );
}
