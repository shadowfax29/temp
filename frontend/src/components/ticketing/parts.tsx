import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNowStrict } from "date-fns";
import { cn } from "@heroui/theme";

import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@/components/ui";
import { PRIORITY_LABEL, STATUS_LABEL, ticketingApi, type PickUser, type Priority, type Status, type TicketRow } from "./api";

const STATUS_STYLE: Record<Status, string> = {
    OPEN: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    ANSWERED: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    RESOLVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    CLOSED: "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300",
    SPAM: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};
const PRIORITY_STYLE: Record<Priority, string> = {
    URGENT: "text-rose-600 dark:text-rose-400", HIGH: "text-orange-600 dark:text-orange-400", MEDIUM: "text-amber-600 dark:text-amber-400", LOW: "text-ink-500 dark:text-ink-400",
};

export const StatusBadge = ({ status }: { status: Status }) => (
    <span className={cn("inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
);
export const PriorityText = ({ priority }: { priority: Priority }) => (
    <span className={cn("text-xs font-bold uppercase tracking-wide", PRIORITY_STYLE[priority])}>{PRIORITY_LABEL[priority]}</span>
);

export const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd MMM yyyy, HH:mm") : "—");
export const ago = (iso: string) => `${formatDistanceToNowStrict(new Date(iso))} ago`;

/** The ticket list: one compact row per ticket that fits the width (nothing scrolls sideways). Smaller screens drop the less important columns. */
export function TicketTable({ rows, showRequester, empty }: { rows: TicketRow[]; showRequester?: boolean; empty: string }) {
    const cols = "grid-cols-[64px_minmax(0,1fr)_104px] md:grid-cols-[64px_minmax(0,1fr)_100px_104px] xl:grid-cols-[64px_minmax(0,1fr)_minmax(150px,0.55fr)_84px_104px_92px]";
    return (
        <div className="border border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900">
            <div className={cn("hidden gap-x-4 border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-white/5 md:grid", cols)}>
                <span>No.</span><span>Subject</span><span className="hidden xl:block">Team and agent</span><span className="md:text-left">Priority</span><span>Status</span><span className="hidden text-right xl:block">Updated</span>
            </div>
            {rows.map((t) => (
                <Link key={t.key} to={`/tickets/${t.key}`} className={cn("grid items-center gap-x-4 gap-y-1 border-b border-ink-100 px-4 py-3 text-sm last:border-b-0 hover:bg-ink-50/70 focus-visible:bg-ink-50 dark:border-white/5 dark:hover:bg-white/[0.04]", cols)}>
                    <span className="font-bold text-brand-600">{t.key}</span>
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-900 dark:text-white">{t.subject}</p>
                        <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                            {t.subcategory === "General" ? t.category : `${t.category} › ${t.subcategory}`}
                            {showRequester && t.requester ? <> · {t.requester}</> : null}
                            <span className="xl:hidden"> · {t.team ?? "Triage"}{t.assignee ? ` · ${t.assignee}` : ""}</span>
                        </p>
                    </div>
                    <div className="hidden min-w-0 xl:block">
                        <p className={cn("truncate", !t.team && "text-amber-600")}>{t.team?.trim() ?? "Triage"}</p>
                        <p className="truncate text-xs text-ink-500 dark:text-ink-400">{t.assignee ?? "Unassigned"}</p>
                    </div>
                    <span className="hidden md:block"><PriorityText priority={t.priority} /></span>
                    <span className="justify-self-end md:justify-self-start"><StatusBadge status={t.status} /></span>
                    <span className="hidden whitespace-nowrap text-right text-xs text-ink-500 dark:text-ink-400 xl:block" title={when(t.updatedAt)}>{ago(t.updatedAt)}</span>
                </Link>
            ))}
            {!rows.length && <p className="px-4 py-12 text-center text-sm text-ink-500 dark:text-ink-400">{empty}</p>}
        </div>
    );
}

/** Type a name or email, pick a person */
export function UserPicker({ label, onPick, placeholder }: { label: string; onPick: (u: PickUser) => void; placeholder?: string }) {
    const [q, setQ] = useState("");
    const [found, setFound] = useState<PickUser[]>([]);
    useEffect(() => {
        if (q.trim().length < 2) { setFound([]); return; }
        const t = setTimeout(() => ticketingApi.users(q).then(setFound).catch(() => setFound([])), 250);
        return () => clearTimeout(t);
    }, [q]);
    return (
        <div className="relative">
            <Input label={label} labelPlacement="outside" placeholder={placeholder ?? "Type a name or email"} value={q} onValueChange={setQ} />
            {found.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto border border-ink-200 bg-white shadow-pop dark:border-white/15 dark:bg-ink-900">
                    {found.map((u) => (
                        <li key={u.id}>
                            <button type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-white/5" onClick={() => { onPick(u); setQ(""); setFound([]); }}>
                                <span className="font-semibold text-ink-900 dark:text-white">{u.name}</span>
                                <span className="text-xs text-ink-500 dark:text-ink-400">{u.email}{u.department ? ` · ${u.department}` : ""}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** An in-page confirmation (no browser alert). Pass the thing to delete, or null to keep it closed. */
export function ConfirmDelete({ title, text, busy, onConfirm, onClose }: { title: string | null; text: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
    return (
        <Modal isOpen={title !== null} onOpenChange={(o) => { if (!o) onClose(); }} size="sm">
            <ModalContent>
                <ModalHeader>{title}</ModalHeader>
                <ModalBody><p className="text-sm text-ink-600 dark:text-ink-300">{text}</p></ModalBody>
                <ModalFooter>
                    <Button variant="light" onPress={onClose}>Cancel</Button>
                    <Button color="danger" isLoading={busy} onPress={onConfirm}>Delete</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
