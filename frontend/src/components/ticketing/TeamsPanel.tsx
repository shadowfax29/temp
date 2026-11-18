import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Select, SelectItem, Switch, addToast } from "@/components/ui";
import { METHODS, PRIVILEGE_LABEL, errorText, ticketingApi, type Method, type Privilege, type SettingsTeam, type TeamDraft } from "./api";
import { Field } from "@/components/Field";
import { ConfirmDelete, UserPicker } from "./parts";
import { NAME_HINT, nameProblem } from "@/lib/names";

const NEW_TEAM: TeamDraft = { name: "", maxOpen: 8, active: true, categoryIds: [], assignmentMethod: "MANUAL" };
interface MemberRow { userId: number; name: string; privilege: Privilege; skills: string[]; isLead: boolean }
const PRIVS: Privilege[] = ["ASSOCIATE", "ADMIN"];

/** Teams: made by the admin. A team has a lead, its members and a way of giving out tickets. */
export default function TeamsPanel({ teams, reload }: { teams: SettingsTeam[]; reload: () => void }) {
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState("");
    const needle = q.trim().toLowerCase();
    const shown = needle ? teams.filter((t) => [t.name, t.leadName ?? "", ...t.members.filter((m) => m.active).map((m) => m.name)].some((x) => x.toLowerCase().includes(needle))) : teams;
    const [del, setDel] = useState<{ id: number; name: string } | null>(null);
    const guard = async (fn: () => Promise<unknown>, ok: string, done?: () => void) => {
        setBusy(true);
        try { await fn(); addToast({ title: ok, color: "success" }); done?.(); reload(); }
        catch (e) { addToast({ title: "Not saved", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };

    // ── the team itself
    const [edit, setEdit] = useState<{ open: boolean; team?: SettingsTeam }>({ open: false });
    const [draft, setDraft] = useState<TeamDraft>(NEW_TEAM);
    const openEdit = (t?: SettingsTeam) => {
        setDraft(t ? { name: t.name, maxOpen: t.maxOpen, active: t.active, categoryIds: t.categories.map((c) => c.id), assignmentMethod: (t.assignmentMethod as Method) ?? "MANUAL" } : NEW_TEAM);
        setEdit({ open: true, team: t });
    };

    // a team that came from UVdesk keeps its name; only a changed name must follow the naming rules
    const teamProblem = edit.team && draft.name.trim() === edit.team.name.trim() ? null : nameProblem("team", draft.name);

    // ── its members
    const [mem, setMem] = useState<{ open: boolean; team?: SettingsTeam; rows: MemberRow[] }>({ open: false, rows: [] });
    const openMembers = (t: SettingsTeam) => setMem({
        open: true, team: t,
        rows: t.members.filter((m) => m.active).map((m) => ({ userId: m.userId, name: m.name, privilege: m.privilege, skills: m.skills, isLead: m.userId === t.leadUserId })),
    });
    const setRow = (id: number, patch: Partial<MemberRow>) => setMem((x) => ({ ...x, rows: x.rows.map((r) => (r.userId === id ? { ...r, ...patch } : r)) }));

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button color="primary" startContent={<Plus size={14} />} onPress={() => openEdit()}>New team</Button>
                <Input aria-label="Search teams" placeholder="Search by team, lead or member" size="sm" className="w-72" isClearable value={q} onValueChange={setQ} />
                <p className="text-xs text-ink-500 dark:text-ink-400">A team is a group of people who handle tickets together, for example IT Support. Add its people and its lead when you create or edit them under Users.</p>
            </div>
            {!!teams.length && !shown.length && <p className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-500 dark:border-white/15 dark:bg-ink-900">No team matches "{q}".</p>}
            {!teams.length && <p className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-500 dark:border-white/15 dark:bg-ink-900">No teams yet. Create one, then add its people.</p>}
            {shown.length > 0 && (
                <div className="overflow-x-auto border border-ink-200 bg-white dark:border-white/10 dark:bg-ink-900">
                    <table className="w-full min-w-[860px] border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-ink-200 bg-ink-50 text-left text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-white/5">
                                <th className="px-4 py-2.5">Team</th><th className="px-4 py-2.5">Lead</th><th className="px-4 py-2.5">Gives out tickets</th>
                                <th className="px-4 py-2.5 text-right">Max open / agent</th><th className="px-4 py-2.5 text-right">Open tickets</th><th className="px-4 py-2.5">Members</th><th className="px-4 py-2.5" />
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((t) => {
                                const active = t.members.filter((m) => m.active);
                                return (
                                    <tr key={t.id} className="border-b border-ink-100 align-top last:border-b-0 hover:bg-ink-50/60 dark:border-white/5 dark:hover:bg-white/[0.03]">
                                        <td className="px-4 py-3 font-semibold">{t.name}{!t.active && <Chip size="sm" color="warning" variant="flat" className="ml-2">Inactive</Chip>}</td>
                                        <td className="px-4 py-3">{t.leadName ?? <span className="text-ink-400">None yet</span>}</td>
                                        <td className="px-4 py-3">{METHODS.find((m) => m.key === t.assignmentMethod)?.label ?? t.assignmentMethod}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{t.maxOpen}</td>
                                        <td className="px-4 py-3 text-right tabular-nums">{t.openTickets}</td>
                                        <td className="px-4 py-3">
                                            <button type="button" className="text-left hover:underline" onClick={() => openMembers(t)} title={active.map((m) => m.name).join(", ")}>
                                                <b>{active.length}</b>{active.length ? <span className="text-ink-500 dark:text-ink-400"> · {active.slice(0, 3).map((m) => m.name).join(", ")}{active.length > 3 ? ` +${active.length - 3} more` : ""}</span> : <span className="text-ink-400"> none</span>}
                                            </button>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right">
                                            <Button isIconOnly size="sm" variant="light" aria-label={`Edit ${t.name}`} onPress={() => openEdit(t)}><Pencil size={14} /></Button>
                                            <Button isIconOnly size="sm" variant="light" aria-label={`Members of ${t.name}`} onPress={() => openMembers(t)}><Users size={14} /></Button>
                                            <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Delete ${t.name}`} onPress={() => setDel({ id: t.id, name: t.name })}><Trash2 size={14} /></Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="lg">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Teams</span><span>{edit.team ? `Edit ${edit.team.name}` : "New team"}</span></DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Field label="Name" required hint={teamProblem ? null : NAME_HINT.team} error={teamProblem}>
                            <Input aria-label="Team name" placeholder="e.g. IT Support" value={draft.name} onValueChange={(v) => setDraft((d) => ({ ...d, name: v }))} maxLength={60} isInvalid={!!teamProblem} />
                        </Field>
                        <Field label="How tickets are given out" hint={METHODS.find((m) => m.key === draft.assignmentMethod)?.hint}>
                            <Select aria-label="How tickets are given out" selectedKeys={new Set([draft.assignmentMethod])} onSelectionChange={(k) => setDraft((d) => ({ ...d, assignmentMethod: String(Array.from(k)[0]) as Method }))}>
                                {METHODS.map((m) => <SelectItem key={m.key}>{m.label}</SelectItem>)}
                            </Select>
                        </Field>
                        <Field label="Most open tickets per agent" hint="Members at this limit are skipped when tickets are given out automatically.">
                            <Input type="number" aria-label="Most open tickets per agent" min={1} value={String(draft.maxOpen)} onValueChange={(v) => setDraft((d) => ({ ...d, maxOpen: Number(v) || 1 }))} />
                        </Field>
                        <Switch isSelected={draft.active} onValueChange={(v) => setDraft((d) => ({ ...d, active: v }))}>Active</Switch>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!draft.name.trim() || !!teamProblem} onPress={() => guard(() => ticketingApi.saveTeam(draft, edit.team?.id), "Team saved", () => setEdit({ open: false }))}>Save team</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <Drawer isOpen={mem.open} onOpenChange={(o) => { if (!o) setMem({ open: false, rows: [] }); }} size="lg">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Members</span><span>{mem.team?.name}</span></DrawerHeader>
                    <DrawerBody className="gap-4">
                        <UserPicker label="Add a person" onPick={(u) => setMem((x) => (x.rows.some((r) => r.userId === u.id) ? x : { ...x, rows: [...x.rows, { userId: u.id, name: u.name, privilege: "ASSOCIATE", skills: [], isLead: false }] }))} />
                        <ul className="flex flex-col divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                            {mem.rows.map((r) => (
                                <li key={r.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                                    <span className="min-w-[140px] flex-1 font-semibold">{r.name}{r.isLead && <span className="ml-2 text-xs font-normal text-ink-500">team lead</span>}</span>
                                    {r.isLead ? <Chip size="sm" variant="flat">{PRIVILEGE_LABEL.LEAD}</Chip> : (
                                        <Select size="sm" className="w-44" aria-label="Privilege" selectedKeys={new Set([r.privilege === "LEAD" ? "ASSOCIATE" : r.privilege])} onSelectionChange={(k) => setRow(r.userId, { privilege: String(Array.from(k)[0]) as Privilege })}>
                                            {PRIVS.map((p) => <SelectItem key={p}>{PRIVILEGE_LABEL[p]}</SelectItem>)}
                                        </Select>
                                    )}
                                    {!r.isLead && <Button isIconOnly size="sm" variant="light" aria-label={`Remove ${r.name}`} onPress={() => setMem((x) => ({ ...x, rows: x.rows.filter((y) => y.userId !== r.userId) }))}><Trash2 size={14} /></Button>}
                                </li>
                            ))}
                            {!mem.rows.length && <li className="px-3 py-3 text-sm text-ink-500">Nobody yet. Search a name above.</li>}
                        </ul>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setMem({ open: false, rows: [] })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} onPress={() => guard(() => ticketingApi.setMembers(mem.team!.id, mem.rows.map((r) => ({ userId: r.userId, privilege: r.privilege, active: true, skills: r.skills }))), "Members saved", () => setMem({ open: false, rows: [] }))}>Save members</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <ConfirmDelete title={del ? `Delete the team "${del.name}"?` : null} text="Its members are not affected; only the team is removed. A team that has handled tickets cannot be deleted: make it inactive instead." busy={busy}
                onClose={() => setDel(null)} onConfirm={() => del && guard(() => ticketingApi.deleteTeam(del.id), "Team deleted", () => setDel(null))} />
        </div>
    );
}
