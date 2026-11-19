import { Field } from "@/components/Field";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Lock, RotateCcw, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@heroui/theme";

import { Panel, Segmented } from "@/components/page";
import { Button, Select, SelectItem, Textarea, addToast } from "@/components/ui";
import {
    PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, errorText, ticketingApi, type Catalog, type History, type Priority, type Status, type TicketDetail, type Transition,
} from "@/components/ticketing/api";
import { Attachments, FilePicker } from "@/components/ticketing/files";
import { PriorityText, StatusBadge, when } from "@/components/ticketing/parts";
import SixDigitTimer from "@/components/ticketing/SixDigitTimer";

type Compose = "reply" | "note";
const NEEDS_LABEL = { comment: "Why?", resolution: "Resolution note (the requester will read this)" } as const;
const EVENT_LABEL: Record<string, string> = { create: "Created", route: "Routing", open: "Opened", assign: "Assignment", status: "Status", field: "Field", reply: "Reply", note: "Note", sla: "SLA", transfer: "Team transfer", recategorize: "Category changed" };

export default function TicketDetailPage() {
    const { key = "" } = useParams();
    const [t, setT] = useState<TicketDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [compose, setCompose] = useState<Compose>("reply");
    const [text, setText] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [mode, setMode] = useState<"assign" | "hand" | null>(null);
    const [pick, setPick] = useState<number | null>(null);
    const [step, setStep] = useState<Transition | null>(null);
    const [stepText, setStepText] = useState("");
    const [tab, setTab] = useState<"conversation" | "history" | "time">("conversation");
    const [hist, setHist] = useState<History | null>(null);

    const load = useCallback(() => {
        setError(null);
        ticketingApi.get(key).then(setT).catch((e) => setError(errorText(e)));
    }, [key]);
    useEffect(() => { setT(null); setHist(null); setTab("conversation"); load(); }, [load]);
    useEffect(() => {
        if (tab === "history" && t?.permissions.isAgent) ticketingApi.history(key).then(setHist).catch((e) => addToast({ title: "Could not load the history", description: errorText(e), color: "danger" }));
    }, [tab, key, t?.permissions.isAgent, t?.updatedAt]);

    /** Runs one action and shows the ticket as it is afterwards */
    const run = async (fn: () => Promise<TicketDetail>, done?: () => void) => {
        setBusy(true);
        try { setT(await fn()); done?.(); }
        catch (e) { addToast({ title: "That did not work", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };

    if (error) {
        return (
            <div className="flex flex-col gap-4">
                <Link to="/tickets" className="flex items-center gap-1.5 text-sm font-semibold text-brand-600"><ArrowLeft size={14} />Tickets</Link>
                <div className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-600 dark:border-white/15 dark:bg-ink-900 dark:text-ink-300">{error}</div>
            </div>
        );
    }
    if (!t) return <p className="text-sm text-ink-500">Loading…</p>;

    const p = t.permissions;
    const send = () => {
        const body = text.trim();
        if (!body) return;
        run(() => (compose === "note" ? ticketingApi.note(t.key, body, files) : ticketingApi.reply(t.key, body, files)), () => { setText(""); setFiles([]); });
    };
    const confirmStep = () => {
        if (!step) return;
        run(() => ticketingApi.status(t.key, step.to, stepText.trim() || undefined), () => { setStep(null); setStepText(""); });
    };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <Link to={"/tickets"} className="mb-3 flex w-fit items-center gap-1.5 text-sm font-semibold text-brand-600"><ArrowLeft size={14} />Back</Link>
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-ink-500">{t.key}</span><StatusBadge status={t.status} /><PriorityText priority={t.priority} />
                </div>
                <h1 className="mt-1 text-xl font-bold text-ink-900 dark:text-white">{t.subject}</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400">{t.subcategory.name === "General" ? t.category.name : `${t.category.name} › ${t.subcategory.name}`} · raised {when(t.createdAt)} by {t.requester.name} ({t.requester.email})</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-w-0 flex-col gap-4">
                    {p.isAgent && <Segmented label="Ticket view" value={tab} onChange={setTab} options={[{ key: "conversation", label: "Conversation" }, { key: "history", label: "History" }, { key: "time", label: "Time & laps" }]} />}

                    {tab === "conversation" ? (
                        <>
                            <div className="flex flex-col gap-3">
                                {t.messages.map((m) => {
                                    const mine = m.authorId === t.requester.id;
                                    if (m.kind === "SYSTEM") return <p key={m.id} className="border-l-2 border-ink-300 py-1 pl-3 text-xs text-ink-500 dark:border-white/20 dark:text-ink-400">{m.body} <span className="text-ink-400">· {when(m.at)}</span></p>;
                                    return (
                                        <div key={m.id} className={cn("border p-4", m.kind === "NOTE" ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : mine ? "border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900" : "border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/5")}>
                                            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                                                <span className="font-bold text-ink-900 dark:text-white">{m.author}</span>
                                                {m.kind === "NOTE" && <span className="flex items-center gap-1 font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Lock size={11} />Internal note</span>}
                                                {mine && <span className="text-ink-500">requester</span>}
                                                <span className="text-ink-400">{when(m.at)}</span>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-ink-800 dark:text-ink-100">{m.body}</p>
                                            <Attachments ticketKey={t.key} items={m.attachments} />
                                        </div>
                                    );
                                })}
                            </div>

                            {(p.canReply || p.canNote) && (
                                <Panel>
                                    <div className="flex flex-col gap-3">
                                        {p.canReply && p.canNote && <Segmented size="sm" label="Write" value={compose} onChange={setCompose} options={[{ key: "reply", label: "Reply to requester" }, { key: "note", label: "Internal note" }]} />}
                                        <Textarea aria-label="Message" minRows={4} placeholder={compose === "note" ? "Only the team sees this" : "Write your reply"} value={text} onValueChange={setText} />
                                        <FilePicker files={files} onChange={setFiles} />
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <span />
                                            <Button color="primary" startContent={<Send size={14} />} isDisabled={!text.trim()} isLoading={busy} onPress={send}>{compose === "note" ? "Add note" : "Send reply"}</Button>
                                        </div>
                                    </div>
                                </Panel>
                            )}
                            {p.canReopen && (
                                <Panel>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <p className="text-sm text-ink-600 dark:text-ink-300">Not fixed? You can reopen it for 7 days after it was resolved.</p>
                                        <Button variant="bordered" startContent={<RotateCcw size={14} />} isLoading={busy} onPress={() => run(() => ticketingApi.reopen(t.key))}>Reopen</Button>
                                    </div>
                                </Panel>
                            )}
                            {t.status === "CLOSED" && <p className="text-sm text-ink-500">This ticket is closed. Raise a new ticket if you need more.</p>}
                        </>
                    ) : tab === "history" ? (
                        <HistoryView hist={hist} />
                    ) : (
                        <LapsPanel t={t} />
                    )}
                </div>

                <aside className="flex flex-col gap-4">
                    <Panel title="Time on this ticket">
                        <div className="flex flex-col gap-1">
                            <SixDigitTimer key={`${t.timer.totalSecs}-${t.timer.running}`} totalSecs={t.timer.totalSecs} running={t.timer.running} since={t.timer.since} />
                            <p className="text-xs text-ink-500 dark:text-ink-400">{t.timer.note}</p>
                        </div>
                    </Panel>

                    <Panel title="Details">
                        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">
                            <dt className="text-ink-500">Assigner</dt><dd><b>{t.requester.name}</b><div className="text-xs text-ink-500">{t.requester.department ?? ""}{t.requester.manager ? ` · manager ${t.requester.manager}` : ""}</div></dd>
                            <dt className="text-ink-500">Team</dt><dd>{t.team?.name ?? <span className="text-amber-600">Triage: no team yet</span>}</dd>
                            <dt className="text-ink-500">Assignee</dt><dd>{t.assignee?.name ?? <span className="text-ink-400">Unassigned</span>}</dd>
                            {t.watchers.length > 0 && <><dt className="text-ink-500">Watching</dt><dd>{t.watchers.map((w) => w.name).join(", ")}</dd></>}
                            <dt className="text-ink-500">Created</dt><dd>{when(t.createdAt)}</dd>
                            <dt className="text-ink-500">Updated</dt><dd>{when(t.updatedAt)}</dd>
                            {t.firstResponseAt && <><dt className="text-ink-500">First response</dt><dd>{when(t.firstResponseAt)}</dd></>}
                            {t.resolvedAt && <><dt className="text-ink-500">Resolved</dt><dd>{when(t.resolvedAt)}</dd></>}
                            {t.fields.filter((f) => f.value !== null && f.value !== "").map((f) => <><dt key={`${f.key}-l`} className="text-ink-500">{f.label}</dt><dd key={`${f.key}-v`}>{String(f.value)}</dd></>)}
                        </dl>
                    </Panel>

                    {p.isAgent && (p.transitions.length > 0 || p.canSetPriority || p.canTake || p.canAssign || p.canHandOver || p.canRoute) && (
                        <Panel title="Work on it">
                            <div className="flex flex-col gap-4">
                                {p.canTake && <Button color="primary" isLoading={busy} onPress={() => run(() => ticketingApi.take(t.key))}>Take this ticket</Button>}

                                {(p.canAssign || p.canHandOver) && (
                                    <div>
                                        <label className="flex cursor-pointer items-center gap-2.5 border border-ink-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-white/10 dark:bg-ink-900">
                                            <input type="checkbox" className="h-4 w-4 accent-[var(--heroui-primary,#ea580c)]" checked={mode === "assign"} onChange={(e) => { setMode(e.target.checked ? "assign" : null); setPick(null); }} />
                                            {t.assignee ? "Reassign this ticket" : "Assign this ticket"}
                                        </label>
                                        {mode === "assign" && (
                                            <div className="flex flex-col gap-3 border border-t-0 border-ink-200 p-3 dark:border-white/10">
                                                <Field label="Person"><Select aria-label="Person" placeholder="Choose a team member" isDisabled={busy} selectedKeys={pick ? new Set([String(pick)]) : new Set<string>()} onSelectionChange={(k) => setPick(Number(Array.from(k)[0]) || null)}>
                                                    {t.teamMembers.map((m) => <SelectItem key={String(m.userId)} textValue={m.name}>{m.name} · {m.open}/{m.limit} open</SelectItem>)}
                                                </Select></Field>
                                                <div className="flex flex-wrap gap-2">
                                                    <Button size="sm" color="primary" isLoading={busy} isDisabled={!pick || pick === t.assignee?.id} onPress={() => run(() => ticketingApi.assign(t.key, pick!), () => { setMode(null); setPick(null); })}>Assign and start the timer</Button>
                                                    {p.canAssign && t.assignee && <Button size="sm" variant="bordered" isLoading={busy} onPress={() => run(() => ticketingApi.assign(t.key, null), () => setMode(null))}>Unassign</Button>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {p.canRoute && (
                                    <Field label="Team" hint={t.team ? "Moving it clears the assignee" : "Waiting in Triage for you to pick the team"}><Select aria-label="Team" placeholder="Choose a team" isDisabled={busy}
                                        selectedKeys={t.team ? new Set([String(t.team.id)]) : new Set<string>()}
                                        onSelectionChange={(k) => { const id = Number(Array.from(k)[0]); if (id && id !== t.team?.id) run(() => ticketingApi.route(t.key, id)); }}>
                                        {t.routeTeams.map((x) => <SelectItem key={String(x.id)}>{x.name}</SelectItem>)}
                                    </Select></Field>
                                )}

                                {p.canSetPriority && (
                                    <Field label="Priority"><Select aria-label="Priority" isDisabled={busy} selectedKeys={new Set([t.priority])}
                                        onSelectionChange={(k) => { const v = String(Array.from(k)[0]) as Priority; if (v && v !== t.priority) run(() => ticketingApi.priority(t.key, v)); }}>
                                        {PRIORITIES.map((x) => <SelectItem key={x}>{PRIORITY_LABEL[x]}</SelectItem>)}
                                    </Select></Field>
                                )}

                                {p.transitions.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <Field label="Status"><Select aria-label="Status" isDisabled={busy} selectedKeys={new Set([t.status])}
                                            onSelectionChange={(k) => {
                                                const to = String(Array.from(k)[0] ?? "") as Status;
                                                const x = p.transitions.find((y) => y.to === to);
                                                if (!x || to === t.status) return;
                                                if (x.needs) setStep(x); else { setStep(null); run(() => ticketingApi.status(t.key, to)); }
                                            }}>
                                            {Array.from(new Set<Status>([t.status, ...p.transitions.map((x) => x.to as Status)])).map((st) => <SelectItem key={st}>{STATUS_LABEL[st]}</SelectItem>)}
                                        </Select></Field>
                                        {step?.needs && (
                                            <div className="flex flex-col gap-2">
                                                <Textarea aria-label={NEEDS_LABEL[step.needs]} placeholder={NEEDS_LABEL[step.needs]} minRows={3} value={stepText} onValueChange={setStepText} />
                                                <div className="flex gap-2">
                                                    <Button size="sm" color="primary" isDisabled={!stepText.trim()} isLoading={busy} onPress={confirmStep}>Set {STATUS_LABEL[step.to]}</Button>
                                                    <Button size="sm" variant="light" onPress={() => { setStep(null); setStepText(""); }}>Cancel</Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </Panel>
                    )}
                    {(p.canTransfer || p.canRecategorize || p.canHandOver) && <HandoffPanel t={t} busy={busy} run={run} mode={mode} setMode={setMode} />}
                </aside>
            </div>
        </div>
    );
}

/** Who did what, and who held the ticket for how long. The chain badge says whether the log has been tampered with. */
function HistoryView({ hist }: { hist: History | null }) {
    if (!hist) return <p className="text-sm text-ink-500">Loading…</p>;
    return (
        <div className="flex flex-col gap-4">
            {!hist.imported && (
                <div className={cn("flex items-center gap-2 border px-4 py-3 text-sm font-semibold", hist.chain.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300")}>
                    {hist.chain.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                    {hist.chain.ok ? `The log is intact: ${hist.chain.events} events, each linked to the one before.` : `The log was altered: event #${hist.chain.brokenAt} does not match what was written.`}
                </div>
            )}
            <Panel title="Who held it" flush>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead><tr className="border-b border-ink-200 bg-ink-50 dark:border-white/10 dark:bg-white/5">{["Team", "Assignee", "Status", "From", "To", "Ended because"].map((h) => <th key={h} className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-500">{h}</th>)}</tr></thead>
                        <tbody>
                            {hist.periods.map((x) => (
                                <tr key={x.id} className="border-b border-ink-100 last:border-0 dark:border-white/5">
                                    <td className="px-4 py-2">{x.team ?? "Triage"}</td><td className="px-4 py-2">{x.assignee ?? "Unassigned"}</td><td className="px-4 py-2"><StatusBadge status={x.status} /></td>
                                    <td className="whitespace-nowrap px-4 py-2 text-xs">{when(x.from)}</td><td className="whitespace-nowrap px-4 py-2 text-xs">{x.to ? when(x.to) : "now"}</td><td className="px-4 py-2 text-xs text-ink-500">{x.endedBecause ?? ""}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>
            <Panel title="Event log" flush>
                <ul className="divide-y divide-ink-100 dark:divide-white/5">
                    {hist.events.map((e) => (
                        <li key={e.id} className="px-5 py-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-bold uppercase tracking-wide text-brand-600">{EVENT_LABEL[e.type] ?? e.type}</span>
                                <span className="font-semibold text-ink-900 dark:text-white">{e.kind === "USER" ? e.actor : e.kind === "RULE" ? "Rule" : "System"}</span>
                                {e.impersonatedBy && <span className="text-amber-600">(switched in by {e.impersonatedBy})</span>}
                                <span className="text-ink-400">{when(e.at)}</span>
                            </div>
                            {e.details && <p className="mt-0.5 text-ink-700 dark:text-ink-200">{e.details}</p>}
                        </li>
                    ))}
                </ul>
            </Panel>
        </div>
    );
}

type Runner = (fn: () => Promise<TicketDetail>, done?: () => void) => Promise<void>;

function LapsPanel({ t }: { t: TicketDetail }) {
    const tm = t.timer;
    if (!tm.laps.length) return <p className="text-sm text-ink-500">No laps recorded yet.</p>;
    return (
        <Panel title="Laps" flush>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr className="border-b border-ink-200 bg-ink-50 dark:border-white/10 dark:bg-white/5">{["Lap", "Owner", "Ended by", "Time"].map((h) => <th key={h} className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-500">{h}</th>)}</tr></thead>
                    <tbody>
                        {tm.laps.map((l) => (
                            <tr key={l.n} className="border-b border-ink-100 last:border-0 dark:border-white/5">
                                <td className="px-4 py-2.5">{l.n}</td>
                                <td className="px-4 py-2.5">{l.owner}{l.team ? <span className="block text-xs text-ink-500">{l.team}</span> : null}</td>
                                <td className="px-4 py-2.5">{l.running ? <span className="font-semibold text-brand-600">running</span> : l.endedBy ?? ""}</td>
                                <td className="px-4 py-2.5 tabular-nums">{hms(l.secs)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Panel>
    );
}

/** The consolidated time as six digits, and under it the laps: who held the ticket, and what ended each lap (the requester sees only the total) */
function TimerPanel({ t }: { t: TicketDetail }) {
    const tm = t.timer;
    return (
        <Panel title="Time on this ticket">
            <div className="flex flex-col gap-3">
                <SixDigitTimer key={`${tm.totalSecs}-${tm.running}`} totalSecs={tm.totalSecs} running={tm.running} since={tm.since} />
                <p className="text-xs text-ink-500 dark:text-ink-400">{tm.note}</p>
                {tm.laps.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[300px] text-xs">
                            <thead><tr className="text-left uppercase tracking-wide text-ink-500"><th className="py-1 pr-2 font-semibold">Lap</th><th className="py-1 pr-2 font-semibold">Owner</th><th className="py-1 pr-2 font-semibold">Ended by</th><th className="py-1 text-right font-semibold">Time</th></tr></thead>
                            <tbody>
                                {tm.laps.map((l) => (
                                    <tr key={l.n} className="border-t border-ink-100 align-top dark:border-white/5">
                                        <td className="py-1.5 pr-2">{l.n}</td><td className="py-1.5 pr-2">{l.owner}{l.team ? <span className="block text-ink-500">{l.team}</span> : null}</td>
                                        <td className="py-1.5 pr-2">{l.running ? <span className="font-semibold text-brand-600">running</span> : l.endedBy ?? ""}</td>
                                        <td className="py-1.5 text-right tabular-nums">{hms(l.secs)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Panel>
    );
}
const hms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Hand off: tick the box, then choose how (another team, another person of this team, or a different category) */
function HandoffPanel({ t, busy, run, mode, setMode }: { t: TicketDetail; busy: boolean; run: Runner; mode: "assign" | "hand" | null; setMode: (m: "assign" | "hand" | null) => void }) {
    const p = t.permissions;
    const kinds = [
        ...(p.canTransfer ? [{ key: "team", label: "Another team" }] : []),
        ...(p.canHandOver ? [{ key: "person", label: "Another person in this team" }] : []),
        ...(p.canRecategorize ? [{ key: "type", label: "A different category" }] : []),
    ];
    const [kind, setKind] = useState(kinds[0]?.key ?? "team");
    const [teamId, setTeamId] = useState<number | null>(null);
    const [personId, setPersonId] = useState<number | null>(null);
    const [reason, setReason] = useState("");
    const [types, setTypes] = useState<Catalog["types"]>([]);
    const [subId, setSubId] = useState<number | null>(null);
    useEffect(() => { if (mode === "hand" && kind === "type" && !types.length) ticketingApi.catalog().then((c) => setTypes(c.types)).catch(() => undefined); }, [mode, kind, types.length]);
    const done = () => { setMode(null); setReason(""); setTeamId(null); setPersonId(null); setSubId(null); };
    const ok = reason.trim().length >= 3 && (kind === "team" ? !!teamId : kind === "person" ? !!personId : !!subId);

    const go = () => {
        const why = reason.trim();
        if (kind === "team") return run(() => ticketingApi.transfer(t.key, teamId!, why), done);
        if (kind === "type") return run(() => ticketingApi.recategorize(t.key, { categoryId: types.find((x) => x.id === subId)!.categoryId, subcategoryId: subId!, reason: why }), done);
        // another person of this team: assign, and keep the reason on the ticket as an internal note
        return run(async () => { await ticketingApi.assign(t.key, personId!); return ticketingApi.note(t.key, `Handed off: ${why}`); }, done);
    };

    return (
        <Panel title="Hand off">
            <div>
                <label className="flex cursor-pointer items-center gap-2.5 border border-ink-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-white/10 dark:bg-ink-900">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--heroui-primary,#ea580c)]" checked={mode === "hand"} onChange={(e) => setMode(e.target.checked ? "hand" : null)} />
                    Hand off this ticket
                </label>
                {mode === "hand" && (
                    <div className="flex flex-col gap-3 border border-t-0 border-ink-200 p-3 dark:border-white/10">
                        <Field label="Hand off to"><Select aria-label="Hand off to" selectedKeys={new Set([kind])} onSelectionChange={(k) => setKind(String(Array.from(k)[0]))}>
                            {kinds.map((x) => <SelectItem key={x.key}>{x.label}</SelectItem>)}
                        </Select></Field>
                        {kind === "team" && (!t.transferTeams.length ? <p className="text-xs text-ink-500">No other team is available.</p> : (
                            <Field label="Team"><Select aria-label="Team" placeholder="Choose a team" selectedKeys={teamId ? new Set([String(teamId)]) : new Set<string>()} onSelectionChange={(k) => setTeamId(Number(Array.from(k)[0]) || null)}>
                                {t.transferTeams.map((x) => <SelectItem key={String(x.id)}>{x.name}</SelectItem>)}
                            </Select></Field>
                        ))}
                        {kind === "person" && (
                            <Field label="Person"><Select aria-label="Person" placeholder="Choose a team member" selectedKeys={personId ? new Set([String(personId)]) : new Set<string>()} onSelectionChange={(k) => setPersonId(Number(Array.from(k)[0]) || null)}>
                                {t.teamMembers.filter((m) => m.userId !== t.assignee?.id).map((m) => <SelectItem key={String(m.userId)} textValue={m.name}>{m.name} · {m.open}/{m.limit} open</SelectItem>)}
                            </Select></Field>
                        )}
                        {kind === "type" && (
                            <Field label="Category"><Select aria-label="Category" placeholder="Choose a category" selectedKeys={subId ? new Set([String(subId)]) : new Set<string>()} onSelectionChange={(k) => setSubId(Number(Array.from(k)[0]) || null)}>
                                {types.map((x) => <SelectItem key={String(x.id)}>{x.name}</SelectItem>)}
                            </Select></Field>
                        )}
                        <Field label="Why"><Textarea aria-label="Why" placeholder="Required: what is done and what is left" minRows={2} value={reason} onValueChange={setReason} /></Field>
                        <p className="text-xs text-ink-500">Ends your lap and starts the next one for the new owner. You stay on the ticket as a watcher.</p>
                        <Button size="sm" color="primary" isLoading={busy} isDisabled={!ok} onPress={go}>Hand off and start a new lap</Button>
                    </div>
                )}
            </div>
        </Panel>
    );
}
