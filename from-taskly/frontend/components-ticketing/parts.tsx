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

/** The ticket table shared by the lists on the Tickets page */
export function TicketTable({ rows, showRequester, empty }: { rows: TicketRow[]; showRequester?: boolean; empty: string }) {
    const heads = ["Ticket ID", "Subject", ...(showRequester ? ["Customer"] : []), "Team", "Agent", "Priority", "Status", "Updated"];
    return (
        <div className="overflow-x-auto border border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900">
            <table className="w-full min-w-[900px] text-sm">
                <thead>
                    <tr className="border-b border-ink-200 bg-ink-50 dark:border-white/10 dark:bg-white/5">
                        {heads.map((h) => <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-500">{h}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((t) => (
                        <tr key={t.key} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/60 dark:border-white/5 dark:hover:bg-white/[0.03]">
                            <td className="whitespace-nowrap px-4 py-3 font-bold"><Link className="text-brand-600 hover:underline" to={`/ticketing/t/${t.key}`}>{t.key}</Link></td>
                            <td className="px-4 py-3">
                                <Link to={`/ticketing/t/${t.key}`} className="font-semibold text-ink-900 hover:text-brand-600 dark:text-white">{t.subject}</Link>
                                <p className="text-xs text-ink-500 dark:text-ink-400">{t.subcategory === "General" ? t.category : `${t.category} › ${t.subcategory}`}</p>
                            </td>
                            {showRequester && <td className="px-4 py-3">{t.requester ?? "—"}{t.requesterEmail && <p className="text-xs text-ink-500 dark:text-ink-400">{t.requesterEmail}</p>}</td>}
                            <td className="px-4 py-3">{t.team ?? <span className="text-amber-600">Triage</span>}</td>
                            <td className="px-4 py-3">{t.assignee ?? <span className="text-ink-400">Unassigned</span>}</td>
                            <td className="px-4 py-3"><PriorityText priority={t.priority} /></td>
                            <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500 dark:text-ink-400" title={when(t.updatedAt)}>{ago(t.updatedAt)}</td>
                        </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={heads.length} className="px-4 py-12 text-center text-sm text-ink-500 dark:text-ink-400">{empty}</td></tr>}
                </tbody>
            </table>
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
