import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@heroui/theme";

import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page";
import { Button, Input, addToast } from "@/components/ui";
import { errorText, ticketingApi, type InboxView, type Me, type TicketList } from "@/components/ticketing/api";
import NewTicketDrawer from "@/components/ticketing/NewTicketDrawer";
import { hasModuleAccess } from "@/lib/permissions";
import { TicketTable } from "@/components/ticketing/parts";

// The ticket list as UVdesk lays it out: views on the left with their counts, the tickets on the right
type View = InboxView | "raised";
const VIEWS: { group: string; items: { key: View; label: string }[] }[] = [
    {
        group: "Tickets", items: [
            { key: "all", label: "All tickets" }, { key: "new", label: "New" }, { key: "unassigned", label: "Unassigned" },
            { key: "unanswered", label: "Unanswered" }, { key: "assigned", label: "Assigned to me" }, { key: "raised", label: "Raised by me" }, { key: "triage", label: "Triage" },
        ],
    },
    {
        group: "Status", items: [
            { key: "pending", label: "Pending" }, { key: "answered", label: "Answered" }, { key: "resolved", label: "Resolved" },
            { key: "closed", label: "Closed" }, { key: "spam", label: "Spam" },
        ],
    },
];
const TITLE: Record<View, string> = Object.fromEntries(VIEWS.flatMap((g) => g.items.map((i) => [i.key, i.label]))) as Record<View, string>;
const HINT: Partial<Record<View, string>> = {
    raised: "The tickets you raised. Open one to follow it and reply to the team.",
    new: "Open tickets nobody on the team has replied to yet.",
    unanswered: "Open tickets waiting for the team: the customer wrote last.",
    triage: "Tickets of groups without a default team. The group owner opens one and picks the team.",
    assigned: "Tickets assigned to you that are not resolved yet.",
};

/** The agent's tickets: mine, my teams' queues, the groups I own */
export default function InboxPage() {
    const [me, setMe] = useState<Me | null>(null);
    const [picked, setPicked] = useState<View>("unanswered");
    const [q, setQ] = useState("");
    const [data, setData] = useState<TicketList | null>(null);
    const [params, setParams] = useSearchParams();
    const [raising, setRaising] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => { ticketingApi.me().then(setMe).catch(() => setMe(null)); }, []);
    // a link to /ticketing/inbox?new=1 opens the New ticket canvas straight away
    useEffect(() => { if (params.get("new") === "1") { setRaising(true); setParams({}, { replace: true }); } }, [params, setParams]);
    const worksTickets = !!me?.isAgent && hasModuleAccess("tkt_inbox");
    // someone who does not work tickets only has the ones they raised
    const view: View = worksTickets ? picked : "raised";
    const setView = setPicked;
    useEffect(() => {
        if (!me || (view !== "raised" && !worksTickets)) return;
        const t = setTimeout(() => {
            const load = view === "raised" ? ticketingApi.mine({ q: q.trim() || undefined, size: 100 }) : ticketingApi.inbox({ view, q: q.trim() || undefined, size: 100 });
            load.then(setData)
                .catch((e) => { addToast({ title: "Could not load the tickets", description: errorText(e), color: "danger" }); setData({ tickets: [], total: 0, page: 1, size: 100 }); });
        }, 200);
        return () => clearTimeout(t);
    }, [me, view, worksTickets, q, reload]);

    const canRaise = hasModuleAccess("tkt_new", "create");
    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Tickets" subtitle={!me ? "Loading…" : !worksTickets ? "The tickets you raised" : me.teams.map((t) => t.name).join(", ") || (me.isAdmin ? "All teams (admin)" : "Groups you own")}>
                {canRaise && <Button color="primary" startContent={<Plus size={14} />} onPress={() => setRaising(true)}>New ticket</Button>}
            </PageHeader>

            <div className={cn("grid gap-6", worksTickets && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
                {worksTickets && <nav aria-label="Ticket views" className="flex h-fit flex-col gap-5 border border-ink-200 bg-white p-3 dark:border-white/10 dark:bg-ink-900">
                    {VIEWS.map((g) => (
                        <div key={g.group}>
                            <p className="eyebrow px-2 pb-1.5">{g.group}</p>
                            {g.items.map((i) => (
                                <button key={i.key} type="button" aria-current={view === i.key} onClick={() => setView(i.key)}
                                    className={cn("flex w-full items-center justify-between px-2 py-2 text-left text-sm transition-colors focus-ring",
                                        view === i.key ? "bg-brand-50 font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5")}>
                                    <span>{i.label}</span>
                                    <span className="text-xs text-ink-500 dark:text-ink-400">{data?.counts?.[i.key] ?? ""}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>}

                <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-900 dark:text-white">{TITLE[view]}</h2>
                            {HINT[view] && <p className="text-xs text-ink-500 dark:text-ink-400">{HINT[view]}</p>}
                        </div>
                        <Input className="max-w-[260px]" size="sm" placeholder="Search subject or ticket ID" value={q} onValueChange={setQ} />
                    </div>
                    {data === null ? <p className="text-sm text-ink-500">Loading…</p> : <TicketTable rows={data.tickets} showRequester={view !== "raised"} empty={view === "raised" ? "You have not raised any ticket yet. Use New ticket." : "No tickets here."} />}
                </div>
            </div>
            <NewTicketDrawer isOpen={raising} onClose={() => setRaising(false)} onCreated={() => { setRaising(false); setReload((n) => n + 1); }} />
        </div>
    );
}
