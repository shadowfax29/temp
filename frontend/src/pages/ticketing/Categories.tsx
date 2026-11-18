import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

import { PageHeader, Panel } from "@/components/page";
import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Switch, addToast } from "@/components/ui";
import { errorText, ticketingApi, type SettingsCategory } from "@/components/ticketing/api";
import { ConfirmDelete } from "@/components/ticketing/parts";
import { Field } from "@/components/Field";
import { hasModuleAccess } from "@/lib/auth";
import { NAME_HINT, nameProblem } from "@/lib/names";

interface Row { id: number; groupId: number; name: string; active: boolean; skill: string | null; counts: { total: number; open: number; resolved: number; pending: number } }
const EMPTY = { name: "", active: true, skill: "" };
type Tab = "active" | "inactive";

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <span className="flex flex-col items-center gap-0.5 min-w-[52px]">
            <span className={`text-sm font-bold ${color}`}>{value}</span>
            <span className="text-[10px] text-ink-400 uppercase tracking-wide">{label}</span>
        </span>
    );
}

/** Ticket categories: what people choose when they raise a ticket (for example VPN access, Laptop request). */
export default function CategoriesPage() {
    const [groups, setGroups] = useState<SettingsCategory[]>([]);
    const [edit, setEdit] = useState<{ open: boolean; row?: Row }>({ open: false });
    const [f, setF] = useState(EMPTY);
    const [del, setDel] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false);
    const [toggling, setToggling] = useState<number | null>(null);
    const [q, setQ] = useState("");
    const [tab, setTab] = useState<Tab>("active");
    const canWrite = hasModuleAccess("tkt_categories", "update");

    const load = useCallback(() => {
        ticketingApi.categories().then(setGroups).catch((e) => addToast({ title: "Could not load the categories", description: errorText(e), color: "danger" }));
    }, []);
    useEffect(load, [load]);

    const catProblem = edit.row && f.name.trim() === edit.row.name.trim() ? null : nameProblem("category", f.name);

    const rows: Row[] = groups.flatMap((g) => g.subcategories.map((s) => ({ id: s.id, groupId: g.id, name: s.name, active: s.active, skill: s.skill, counts: s.counts ?? { total: 0, open: 0, resolved: 0, pending: 0 } })));
    const activeRows = rows.filter((r) => r.active);
    const inactiveRows = rows.filter((r) => !r.active);

    const needle = q.trim().toLowerCase();
    const tabRows = tab === "active" ? activeRows : inactiveRows;
    const shown = needle ? tabRows.filter((r) => r.name.toLowerCase().includes(needle) || (r.skill ?? "").toLowerCase().includes(needle)) : tabRows;

    const open = (row?: Row) => { setF(row ? { name: row.name, active: row.active, skill: row.skill ?? "" } : EMPTY); setEdit({ open: true, row }); };
    const guard = async (fn: () => Promise<unknown>, ok: string, done: () => void) => {
        setBusy(true);
        try { await fn(); addToast({ title: ok, color: "success" }); done(); load(); }
        catch (e) { addToast({ title: "Not saved", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };

    const toggleActive = async (r: Row) => {
        setToggling(r.id);
        try {
            await ticketingApi.saveSub(r.groupId, { name: r.name, active: !r.active, defaultTeamId: null, skill: r.skill ?? null }, r.id);
            addToast({ title: r.active ? `"${r.name}" deactivated` : `"${r.name}" activated`, color: "success" });
            load();
        } catch (e) { addToast({ title: "Could not update", description: errorText(e), color: "danger" }); }
        finally { setToggling(null); }
    };

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Ticket categories" subtitle="What people choose when they raise a ticket, for example VPN access or Laptop request.">
                {canWrite && <Button color="primary" startContent={<Plus size={14} />} onPress={() => open()}>New category</Button>}
            </PageHeader>

            {/* Active / Inactive tabs */}
            <div className="flex gap-0 border-b border-ink-200 dark:border-white/10">
                {(["active", "inactive"] as Tab[]).map((t) => {
                    const count = t === "active" ? activeRows.length : inactiveRows.length;
                    return (
                        <button
                            key={t}
                            type="button"
                            onClick={() => { setTab(t); setQ(""); }}
                            className={[
                                "relative px-5 py-2.5 text-sm font-semibold transition-colors",
                                tab === t
                                    ? "text-primary-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary-600 dark:text-primary-400 dark:after:bg-primary-400"
                                    : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200",
                            ].join(" ")}
                        >
                            {t === "active" ? "Active" : "Inactive"}
                            <span className={[
                                "ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                                tab === t ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300" : "bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-400",
                            ].join(" ")}>{count}</span>
                        </button>
                    );
                })}
            </div>

            <Panel
                title={needle ? `${tab === "active" ? "Active" : "Inactive"} categories (${shown.length} of ${tabRows.length})` : `${tab === "active" ? "Active" : "Inactive"} categories (${tabRows.length})`}
                actions={<Input aria-label="Search categories" placeholder="Search by name or skill" size="sm" className="w-64" isClearable value={q} onValueChange={setQ} />}
            >
                {!rows.length ? (
                    <p className="text-sm text-ink-500">No categories yet. People cannot raise tickets until there is one.</p>
                ) : !tabRows.length ? (
                    <p className="text-sm text-ink-500">{tab === "active" ? "No active categories." : "No inactive categories."}</p>
                ) : !shown.length ? (
                    <p className="text-sm text-ink-500">No category matches "{q}".</p>
                ) : (
                    <div className="divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                        {/* header row */}
                        <div className="flex items-center gap-3 bg-ink-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-400 dark:bg-white/5">
                            <span className="flex-1 min-w-0">Name</span>
                            <span className="flex gap-6 pr-2 flex-shrink-0">
                                <span className="w-[52px] text-center">Total</span>
                                <span className="w-[52px] text-center">Open</span>
                                <span className="w-[52px] text-center">Resolved</span>
                                <span className="w-[52px] text-center">Pending</span>
                            </span>
                            {canWrite && <span className="w-[228px] flex-shrink-0" />}
                        </div>
                        {shown.map((r) => (
                            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-ink-50/60 dark:hover:bg-white/[0.03]">
                                <span className="flex flex-1 items-center gap-2 font-semibold min-w-0 overflow-hidden">
                                    <span className="truncate">{r.name}</span>
                                    {r.skill && <Chip size="sm" variant="bordered" className="flex-shrink-0">skill: {r.skill}</Chip>}
                                </span>
                                <span className="flex gap-6 pr-2 flex-shrink-0">
                                    <StatBadge label="Total" value={r.counts.total} color="text-ink-800 dark:text-ink-100" />
                                    <StatBadge label="Open" value={r.counts.open} color="text-blue-600 dark:text-blue-400" />
                                    <StatBadge label="Resolved" value={r.counts.resolved} color="text-emerald-600 dark:text-emerald-400" />
                                    <StatBadge label="Pending" value={r.counts.pending} color="text-amber-600 dark:text-amber-400" />
                                </span>
                                {canWrite && (
                                    <span className="flex gap-1 w-[228px] flex-shrink-0 justify-end">
                                        <Button
                                            size="sm" variant="light" isLoading={toggling === r.id}
                                            startContent={r.active ? <ToggleRight size={14} className="text-emerald-500" /> : <ToggleLeft size={14} className="text-ink-400" />}
                                            onPress={() => toggleActive(r)}
                                        >
                                            {r.active ? "Deactivate" : "Activate"}
                                        </Button>
                                        <Button size="sm" variant="light" startContent={<Pencil size={13} />} onPress={() => open(r)}>Edit</Button>
                                        <Button size="sm" variant="light" color="danger" startContent={<Trash2 size={13} />} onPress={() => setDel(r)}>Delete</Button>
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Panel>

            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="sm">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Ticket categories</span><span>{edit.row ? "Edit category" : "New category"}</span></DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Field label="Name" required hint={catProblem ? null : NAME_HINT.category} error={catProblem}>
                            <Input aria-label="Category name" placeholder="e.g. VPN access" value={f.name} onValueChange={(v) => setF((x) => ({ ...x, name: v }))} maxLength={60} isInvalid={!!catProblem} />
                        </Field>
                        <Field label="Skill needed" hint="Optional. Teams that give tickets out by skill choose members who have this skill.">
                            <Input aria-label="Skill needed" placeholder="e.g. VPN" value={f.skill} onValueChange={(v) => setF((x) => ({ ...x, skill: v }))} />
                        </Field>
                        <Switch isSelected={f.active} onValueChange={(v) => setF((x) => ({ ...x, active: v }))}>Shown when raising a ticket</Switch>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!f.name.trim() || !!catProblem}
                            onPress={() => guard(() => ticketingApi.saveSub(edit.row?.groupId ?? 0, { name: f.name, active: f.active, defaultTeamId: null, skill: f.skill.trim() || null }, edit.row?.id), "Category saved", () => setEdit({ open: false }))}>Save</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
            <ConfirmDelete title={del ? `Delete the category "${del.name}"?` : null} text="This cannot be undone. A category that tickets already use cannot be deleted: hide it instead." busy={busy}
                onClose={() => setDel(null)} onConfirm={() => del && guard(() => ticketingApi.deleteSub(del.id), "Category deleted", () => setDel(null))} />
        </div>
    );
}
