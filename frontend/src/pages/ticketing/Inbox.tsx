import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Plus, ChevronDown } from "lucide-react";

import { PageHeader } from "@/components/page";
import { Button, Input, addToast } from "@/components/ui";
import { errorText, ticketingApi, type InboxView, type Me, type TicketList } from "@/components/ticketing/api";
import NewTicketDrawer from "@/components/ticketing/NewTicketDrawer";
import { hasModuleAccess } from "@/lib/permissions";
import { TicketTable } from "@/components/ticketing/parts";

type View = InboxView | "raised";
const PAGE = 25;

const QUEUE_ITEMS: { key: View; label: string }[] = [
    { key: "all", label: "All tickets" },
    { key: "new", label: "New" },
    { key: "unassigned", label: "Unassigned" },
    { key: "unanswered", label: "Unanswered" },
    { key: "assigned", label: "Assigned to me" },
    { key: "raised", label: "Raised by me" },
    { key: "triage", label: "Triage" },
];

const STATUS_ITEMS: { key: View; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "answered", label: "Answered" },
    { key: "resolved", label: "Resolved" },
    { key: "closed", label: "Closed" },
    { key: "spam", label: "Spam" },
];

const ALL_ITEMS = [...QUEUE_ITEMS, ...STATUS_ITEMS];
const TITLE: Record<View, string> = Object.fromEntries(ALL_ITEMS.map((i) => [i.key, i.label])) as Record<View, string>;
const HINT: Partial<Record<View, string>> = {
    raised: "The tickets you raised. Open one to follow it and reply to the team.",
    new: "Open tickets nobody on the team has replied to yet.",
    unanswered: "Open tickets waiting for the team: the customer wrote last.",
    triage: "Tickets of groups without a default team. The group owner opens one and picks the team.",
    assigned: "Tickets assigned to you that are not resolved yet.",
};

function FilterDropdown({ label, items, active, counts, onSelect }: {
    label: string;
    items: { key: View; label: string }[];
    active: View;
    counts?: Record<string, number>;
    onSelect: (v: View) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);
    const activeItem = items.find((i) => i.key === active);
    const isActive = !!activeItem;
    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((x) => !x)}
                className={[
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors border",
                    isActive
                        ? "border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-300"
                        : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50 dark:border-white/10 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-white/5",
                ].join(" ")}
            >
                <span>{isActive ? activeItem.label : label}</span>
                {isActive && counts?.[active] != null && (
                    <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[11px] font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">{counts[active]}</span>
                )}
                <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {open && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded border border-ink-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-ink-900">
                    {items.map((i) => (
                        <button
                            key={i.key}
                            type="button"
                            onClick={() => { onSelect(i.key); setOpen(false); }}
                            className={[
                                "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors",
                                active === i.key
                                    ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                                    : "text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5",
                            ].join(" ")}
                        >
                            <span>{i.label}</span>
                            {counts?.[i.key] != null && counts[i.key]! > 0 && (
                                <span className="ml-3 text-xs text-ink-400">{counts[i.key]}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function InboxPage() {
    const [me, setMe] = useState<Me | null>(null);
    const [picked, setPicked] = useState<View>("unanswered");
    const [q, setQ] = useState("");
    const [data, setData] = useState<TicketList | null>(null);
    const [params, setParams] = useSearchParams();
    const [raising, setRaising] = useState(false);
    const [reload, setReload] = useState(0);
    const [page, setPage] = useState(1);

    useEffect(() => { ticketingApi.me().then(setMe).catch(() => setMe(null)); }, []);
    useEffect(() => { if (params.get("new") === "1") { setRaising(true); setParams({}, { replace: true }); } }, [params, setParams]);
    const worksTickets = !!me?.isAgent && hasModuleAccess("tkt_inbox");
    const view: View = worksTickets ? picked : "raised";
    const setView = setPicked;
    useEffect(() => {
        if (!me || (view !== "raised" && !worksTickets)) return;
        const t = setTimeout(() => {
            const load = view === "raised"
                ? ticketingApi.mine({ q: q.trim() || undefined, page, size: PAGE })
                : ticketingApi.inbox({ view, q: q.trim() || undefined, page, size: PAGE });
            load.then(setData).catch((e) => {
                addToast({ title: "Could not load the tickets", description: errorText(e), color: "danger" });
                setData({ tickets: [], total: 0, page: 1, size: 100 });
            });
        }, 200);
        return () => clearTimeout(t);
    }, [me, view, worksTickets, q, reload, page]);

    const canRaise = hasModuleAccess("tkt_new", "create");

    return (
        <div className="flex flex-col gap-4">
            <PageHeader
                title="Tickets"
                subtitle={!me ? "Loading…" : !worksTickets ? "The tickets you raised" : me.teams.map((t) => t.name).join(", ") || (me.isAdmin ? "All teams (admin)" : "Groups you own")}
            >
                {canRaise && <Button color="primary" startContent={<Plus size={14} />} onPress={() => setRaising(true)}>New ticket</Button>}
            </PageHeader>

            {worksTickets && (
                <div className="flex flex-wrap items-center gap-3">
                    <FilterDropdown
                        label="Queue"
                        items={QUEUE_ITEMS}
                        active={view}
                        counts={data?.counts}
                        onSelect={(v) => { setView(v); setPage(1); }}
                    />
                    <FilterDropdown
                        label="Status"
                        items={STATUS_ITEMS}
                        active={view}
                        counts={data?.counts}
                        onSelect={(v) => { setView(v); setPage(1); }}
                    />
                </div>
            )}

            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-900 dark:text-white">{TITLE[view]}</h2>
                        {HINT[view] && <p className="text-xs text-ink-500 dark:text-ink-400">{HINT[view]}</p>}
                    </div>
                    <Input className="max-w-[260px]" size="sm" placeholder="Search subject or ticket ID" value={q} onValueChange={(v) => { setQ(v); setPage(1); }} />
                </div>
                {data === null
                    ? <p className="text-sm text-ink-500">Loading…</p>
                    : <TicketTable rows={data.tickets} showRequester={view !== "raised"} empty={view === "raised" ? "You have not raised any ticket yet. Use New ticket." : "No tickets here."} />}
                {data && data.total > PAGE && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="text-ink-500">{(page - 1) * PAGE + 1} to {Math.min(page * PAGE, data.total)} of {data.total} tickets</span>
                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="bordered" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Previous</Button>
                            <span className="px-2 text-xs text-ink-500">Page {page} of {Math.ceil(data.total / PAGE)}</span>
                            <Button size="sm" variant="bordered" isDisabled={page >= Math.ceil(data.total / PAGE)} onPress={() => setPage(page + 1)}>Next</Button>
                        </div>
                    </div>
                )}
            </div>

            <NewTicketDrawer isOpen={raising} onClose={() => setRaising(false)} onCreated={() => { setRaising(false); setReload((n) => n + 1); }} />
        </div>
    );
}
