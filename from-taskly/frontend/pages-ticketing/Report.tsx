import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";

import { PageHeader, Panel, SummaryBar } from "@/components/page";
import { Button, Input, Select, SelectItem, addToast } from "@/components/ui";
import { StatusBadge } from "@/components/ticketing/parts";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, errorText, ticketingApi, type ReportRow, type Status, type TicketReport } from "@/components/ticketing/api";

const ALL = "_all";
const STATUS_LIST = Object.keys(STATUS_LABEL) as Status[];
const PRESETS: { label: string; days: number }[] = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }];

/** One choice in a filter, with "All" as the empty value */
function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { key: string; name: string }[] }) {
    return (
        <Select size="sm" className="w-44" label={label} labelPlacement="outside" selectedKeys={new Set([value || ALL])} onSelectionChange={(k) => { const v = String(Array.from(k)[0] ?? ALL); onChange(v === ALL ? "" : v); }}>
            {[{ key: ALL, name: "All" }, ...options].map((o) => <SelectItem key={o.key}>{o.name}</SelectItem>)}
        </Select>
    );
}

/** Tickets raised on each day of the period (days with none count as zero) */
function DayChart({ from, to, data }: { from: string; to: string; data: { day: string; total: number }[] }) {
    const by = new Map(data.map((d) => [d.day, d.total]));
    const days: { day: string; total: number }[] = [];
    for (let t = Date.parse(from); t <= Date.parse(to) && days.length < 400; t += 86_400_000) { const k = new Date(t).toISOString().slice(0, 10); days.push({ day: k, total: by.get(k) ?? 0 }); }
    const top = Math.max(1, ...days.map((d) => d.total));
    const step = Math.ceil(days.length / 10);
    const H = 120;
    return (
        <div className="flex gap-3">
            <div className="flex flex-col justify-between text-right text-[11px] text-ink-500" style={{ height: H }}><span>{top}</span><span>{Math.round(top / 2)}</span><span>0</span></div>
            <div className="min-w-0 flex-1">
                <div className="relative flex items-end gap-[3px] border-b border-l border-ink-200 dark:border-white/15" style={{ height: H }} role="img" aria-label="Tickets raised per day">
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-ink-200 dark:border-white/10" />
                    {days.map((d) => (
                        <div key={d.day} title={`${d.day}: ${d.total} ticket${d.total === 1 ? "" : "s"}`} className="flex h-full flex-1 items-end justify-center">
                            <div className={d.total ? "w-full max-w-[22px] bg-brand-600" : "w-full max-w-[22px] bg-ink-200 dark:bg-white/10"} style={{ height: d.total ? Math.max(4, (d.total / top) * (H - 4)) : 2 }} />
                        </div>
                    ))}
                </div>
                <div className="mt-1 flex gap-[3px] text-[11px] text-ink-500">
                    {days.map((d, i) => <span key={d.day} className="flex-1 whitespace-nowrap text-center">{i % step === 0 ? d.day.slice(5) : ""}</span>)}
                </div>
            </div>
        </div>
    );
}
const mins = (m: number | null | undefined) => (m == null ? "—" : m < 60 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);
const age = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const label = (k: string) => (STATUS_LABEL as Record<string, string>)[k] ?? (PRIORITY_LABEL as Record<string, string>)[k] ?? k;

const SHADE: Record<string, { bar: string; dot: string }> = {
    OPEN: { bar: "bg-sky-500", dot: "bg-sky-500" }, PENDING: { bar: "bg-amber-500", dot: "bg-amber-500" }, ANSWERED: { bar: "bg-indigo-500", dot: "bg-indigo-500" },
    RESOLVED: { bar: "bg-emerald-500", dot: "bg-emerald-500" }, CLOSED: { bar: "bg-slate-500", dot: "bg-slate-500" }, SPAM: { bar: "bg-rose-500", dot: "bg-rose-500" },
    URGENT: { bar: "bg-red-600", dot: "bg-red-600" }, HIGH: { bar: "bg-orange-500", dot: "bg-orange-500" }, MEDIUM: { bar: "bg-amber-400", dot: "bg-amber-400" }, LOW: { bar: "bg-slate-400", dot: "bg-slate-400" },
};

/** One bar split into the share of each value, with a legend underneath (status, priority) */
function Share({ title, rows }: { title: string; rows: ReportRow[] }) {
    const sum = rows.reduce((n, r) => n + r.total, 0) || 1;
    return (
        <Panel title={title}>
            {!rows.length ? <p className="text-sm text-ink-500">Nothing in this period.</p> : (
                <div className="flex flex-col gap-4">
                    <div className="flex h-3 w-full overflow-hidden bg-ink-100 dark:bg-white/10" role="img" aria-label={title}>
                        {rows.map((r) => <div key={r.name} title={`${label(r.name)}: ${r.total}`} className={SHADE[r.name]?.bar ?? "bg-ink-400"} style={{ width: `${(r.total / sum) * 100}%` }} />)}
                    </div>
                    <ul className="flex flex-col gap-2">
                        {rows.map((r) => (
                            <li key={r.name} className="flex items-center gap-3 text-sm">
                                <span className={`h-2.5 w-2.5 shrink-0 ${SHADE[r.name]?.dot ?? "bg-ink-400"}`} />
                                <span className="flex-1 font-medium">{label(r.name)}</span>
                                <span className="w-10 text-right text-xs text-ink-500 dark:text-ink-400">{Math.round((r.total / sum) * 100)}%</span>
                                <span className="w-8 text-right font-bold">{r.total}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Panel>
    );
}

type Col = { head: string; get: (r: ReportRow) => string | number };
/** A ranked list: the name, a bar for its share of the tickets, the total and a few aligned figures */
function Ranked({ title, rows, cols = [] }: { title: string; rows: ReportRow[]; cols?: Col[] }) {
    const max = Math.max(1, ...rows.map((r) => r.total));
    return (
        <Panel title={title}>
            {!rows.length ? <p className="text-sm text-ink-500">Nothing in this period.</p> : (
                <div className="flex flex-col">
                    <div className="mb-1 flex items-center gap-4 text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                        <span className="flex-1">Name</span><span className="w-10 text-right">Total</span>
                        {cols.map((c) => <span key={c.head} className="w-20 text-right">{c.head}</span>)}
                    </div>
                    {rows.map((r) => (
                        <div key={r.name} className="flex items-center gap-4 border-t border-ink-100 py-2.5 text-sm dark:border-white/5">
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{r.name}</p>
                                <div className="mt-1 h-1.5 w-full bg-ink-100 dark:bg-white/10"><div className="h-1.5 bg-brand-600" style={{ width: `${(r.total / max) * 100}%` }} /></div>
                            </div>
                            <span className="w-10 text-right text-base font-bold">{r.total}</span>
                            {cols.map((c) => <span key={c.head} className="w-20 text-right text-ink-700 dark:text-ink-200">{c.get(r)}</span>)}
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    );
}

const AGE_TONE = (h: number) => (h >= 72 ? "text-red-600 dark:text-red-400" : h >= 24 ? "text-amber-600 dark:text-amber-400" : "text-ink-700 dark:text-ink-200");

/** One consolidated summary of the tickets a person may see, for a period */
export default function TicketReportPage() {
    const today = new Date();
    const [from, setFrom] = useState(day(new Date(today.getTime() - 29 * 86_400_000)));
    const [to, setTo] = useState(day(today));
    const [teamId, setTeamId] = useState("");
    const [status, setStatus] = useState("");
    const [priority, setPriority] = useState("");
    const [typeId, setTypeId] = useState("");
    const [agent, setAgent] = useState("");
    const [q, setQ] = useState("");
    const [qLive, setQLive] = useState("");
    const [r, setR] = useState<TicketReport | null>(null);

    useEffect(() => {
        const t = setTimeout(() => {
            ticketingApi.report({
                from, to, teamId: teamId ? Number(teamId) : undefined, status: status || undefined, priority: priority || undefined, typeId: typeId ? Number(typeId) : undefined,
                assigneeId: agent && agent !== "none" ? Number(agent) : undefined, unassigned: agent === "none" ? "1" : undefined, q: q.trim() || undefined,
            }).then(setR).catch((e) => { addToast({ title: "Could not load the report", description: errorText(e), color: "danger" }); });
        }, 250);
        return () => clearTimeout(t);
    }, [from, to, teamId, status, priority, typeId, agent, q]);
    useEffect(() => { const t = setTimeout(() => setQ(qLive), 400); return () => clearTimeout(t); }, [qLive]);
    const preset = (days: number) => { const e = new Date(); setTo(day(e)); setFrom(day(new Date(e.getTime() - (days - 1) * 86_400_000))); };
    const thisMonth = () => { const e = new Date(); setTo(day(e)); setFrom(day(new Date(e.getFullYear(), e.getMonth(), 1, 12))); };
    const anyFilter = !!(teamId || status || priority || typeId || agent || q);
    const clear = () => { setTeamId(""); setStatus(""); setPriority(""); setTypeId(""); setAgent(""); setQLive(""); setQ(""); };

    const download = () => {
        if (!r) return;
        const lines: string[][] = [["Ticket report", `${r.from} to ${r.to}`], [],
            ["Raised", String(r.totals.raised)], ["Open", String(r.totals.open)], ["Resolved", String(r.totals.resolved)], ["Closed", String(r.totals.closed)], ["Spam", String(r.totals.spam)],
            ["Unassigned", String(r.totals.unassigned)], ["Average first reply (min)", String(r.totals.avgFirstResponseMin ?? "")], ["Average time to resolve (hours)", String(r.totals.avgResolutionHours ?? "")], []];
        const add = (t: string, rows: ReportRow[]) => { lines.push([t, "Tickets", "Open", "Resolved or closed"]); rows.forEach((x) => lines.push([label(x.name), String(x.total), String(x.open ?? ""), String(x.done ?? "")])); lines.push([]); };
        add("By status", r.byStatus); add("By priority", r.byPriority); add("By team", r.byTeam); add("By ticket type", r.byType); add("By agent", r.byAgent); add("Raised by", r.byRequester);
        const csv = lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `ticket-report-${r.from}-to-${r.to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Ticket report" subtitle="A consolidated summary of the tickets raised in the period, for the teams you can see.">
                <Button variant="bordered" startContent={<Download size={14} />} isDisabled={!r} onPress={download}>Download CSV</Button>
            </PageHeader>

            <Panel>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <Input type="date" size="sm" className="w-40" label="From" labelPlacement="outside" value={from} max={to} onValueChange={(v) => v && setFrom(v)} />
                        <Input type="date" size="sm" className="w-40" label="To" labelPlacement="outside" value={to} min={from} onValueChange={(v) => v && setTo(v)} />
                        <div className="flex gap-1.5 pb-0.5">
                            {PRESETS.map((p) => <Button key={p.days} size="sm" variant="flat" onPress={() => preset(p.days)}>{p.label}</Button>)}
                            <Button size="sm" variant="flat" onPress={thisMonth}>This month</Button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                        <Pick label="Team" value={teamId} onChange={setTeamId} options={(r?.teams ?? []).map((t) => ({ key: String(t.id), name: t.name }))} />
                        <Pick label="Ticket type" value={typeId} onChange={setTypeId} options={(r?.types ?? []).map((t) => ({ key: String(t.id), name: t.name }))} />
                        <Pick label="Status" value={status} onChange={setStatus} options={STATUS_LIST.map((x) => ({ key: x, name: STATUS_LABEL[x] }))} />
                        <Pick label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((x) => ({ key: x, name: PRIORITY_LABEL[x] }))} />
                        <Pick label="Agent" value={agent} onChange={setAgent} options={[{ key: "none", name: "Unassigned" }, ...(r?.agents ?? []).map((x) => ({ key: String(x.id), name: x.name }))]} />
                        <Input size="sm" className="w-56" label="Search" labelPlacement="outside" placeholder="Subject or ticket ID" value={qLive} onValueChange={setQLive} />
                        {anyFilter && <Button size="sm" variant="light" onPress={clear}>Clear filters</Button>}
                    </div>
                </div>
            </Panel>

            {!r ? <p className="text-sm text-ink-500">Loading…</p> : (
                <>
                    <div>
                        <SummaryBar className="mb-0 border-b-0" items={[
                            { label: "Raised", value: r.totals.raised, hint: `${r.from} to ${r.to}` },
                            { label: "Open now", value: r.totals.open, hint: `${r.totals.unassigned} unassigned · ${r.totals.triage} in Triage` },
                            { label: "Resolved or closed", value: r.totals.resolved + r.totals.closed, hint: `${r.totals.resolvedPercent}% of those raised` },
                            { label: "Spam", value: r.totals.spam },
                        ]} />
                        <SummaryBar items={[
                            { label: "Average first reply", value: mins(r.totals.avgFirstResponseMin), hint: "From raised to the team's first public reply" },
                            { label: "Average time to resolve", value: r.totals.avgResolutionHours == null ? "—" : `${r.totals.avgResolutionHours} h`, hint: "From raised to Resolved" },
                            { label: "Resolved", value: r.totals.resolved }, { label: "Closed", value: r.totals.closed },
                        ]} />
                    </div>

                    <Panel title="Raised per day"><DayChart from={r.from} to={r.to} data={r.perDay} /></Panel>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Share title="By status" rows={r.byStatus} />
                        <Share title="By priority" rows={r.byPriority} />
                        <Ranked title="By team" rows={r.byTeam} cols={[{ head: "Open", get: (x) => x.open ?? 0 }, { head: "Resolved", get: (x) => x.done ?? 0 }, { head: "First reply", get: (x) => mins(x.firstResponseMin) }]} />
                        <Ranked title="By ticket type" rows={r.byType} cols={[{ head: "Open", get: (x) => x.open ?? 0 }]} />
                        <Ranked title="By agent (assigned)" rows={r.byAgent} cols={[{ head: "Open", get: (x) => x.open ?? 0 }, { head: "Resolved", get: (x) => x.done ?? 0 }]} />
                        <Ranked title="Raised by (top 10)" rows={r.byRequester} />
                    </div>

                    <Panel title="Oldest open tickets">
                        {!r.oldestOpen.length ? <p className="text-sm text-ink-500">Nothing open.</p> : (
                            <div className="flex flex-col">
                                {r.oldestOpen.map((t) => (
                                    <Link key={t.key} to={`/ticketing/t/${t.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-100 py-3 text-sm first:border-t-0 hover:bg-ink-50 dark:border-white/5 dark:hover:bg-white/5">
                                        <span className="w-24 font-bold text-brand-600">{t.key}</span>
                                        <span className="min-w-[160px] flex-1 truncate font-medium">{t.subject}</span>
                                        <StatusBadge status={t.status} />
                                        <span className="w-40 truncate text-ink-600 dark:text-ink-300">{t.team ?? "Triage"} · {t.assignee ?? "Unassigned"}</span>
                                        <span className={`w-16 text-right font-bold ${AGE_TONE(t.ageHours)}`}>{age(t.ageHours)}</span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </Panel>
                </>
            )}
        </div>
    );
}
