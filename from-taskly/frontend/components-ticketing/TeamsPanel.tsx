import { useState } from "react";
import { Building2, Pencil, RefreshCw, Trash2, Users } from "lucide-react";
import { cn } from "@heroui/theme";

import { Panel } from "@/components/page";
import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Select, SelectItem, Switch, addToast } from "@/components/ui";
import {
    METHODS, PRIVILEGE_LABEL, errorText, ticketingApi,
    type DepartmentTree, type Method, type Privilege, type SettingsTeam, type TeamDraft,
} from "./api";
import { ConfirmDelete, UserPicker } from "./parts";

const NEW_CUSTOM: TeamDraft = { name: "", leadUserId: null, maxOpen: 8, active: true, categoryIds: [], assignmentMethod: "MANUAL" };

interface MemberRow { userId: number; name: string; privilege: Privilege; skills: string[]; include: boolean; source: "DEPT" | "MANUAL" }

/**
 * Teams. A team is normally an existing sub department (Department Management): its people are the members and its leader the team lead,
 * kept in step automatically. Ticketing only reads the department; nothing there changes. A custom team (built by hand) is the exception.
 */
export default function TeamsPanel({ teams, reload }: { teams: SettingsTeam[]; reload: () => void }) {
    const [busy, setBusy] = useState(false);
    const [del, setDel] = useState<{ id: number; name: string } | null>(null);
    const guard = async (fn: () => Promise<unknown>, ok: string, done?: () => void) => {
        setBusy(true);
        try { await fn(); addToast({ title: ok, color: "success" }); done?.(); reload(); }
        catch (e) { addToast({ title: "Not saved", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };

    // ── add from a department
    const [add, setAdd] = useState<{ open: boolean; tree: DepartmentTree[] | null; subId: number | null; name: string; q: string }>({ open: false, tree: null, subId: null, name: "", q: "" });
    const openAdd = () => {
        setAdd({ open: true, tree: null, subId: null, name: "", q: "" });
        ticketingApi.departments().then((tree) => setAdd((a) => ({ ...a, tree }))).catch((e) => { addToast({ title: "Could not load the departments", description: errorText(e), color: "danger" }); setAdd((a) => ({ ...a, tree: [] })); });
    };
    const flat = (add.tree ?? []).flatMap((d) => d.subDepartments.map((x) => ({ ...x, deptName: d.name })));
    const sub = flat.find((x) => x.id === add.subId);
    const needle = add.q.trim().toLowerCase();
    const shown = (add.tree ?? []).map((d) => ({ ...d, subDepartments: d.subDepartments.filter((x) => !needle || x.name.toLowerCase().includes(needle) || d.name.toLowerCase().includes(needle)) })).filter((d) => d.subDepartments.length);
    const RELATION = { EL: "You are its Executive Leader", FL: "You are its Functional Leader", MANAGER: "" } as const;

    // ── edit
    const [edit, setEdit] = useState<{ open: boolean; team?: SettingsTeam }>({ open: false });
    const [draft, setDraft] = useState<TeamDraft>(NEW_CUSTOM);
    const [lead, setLead] = useState<string | null>(null);
    const openEdit = (t?: SettingsTeam) => {
        setDraft(t ? { name: t.name, leadUserId: t.leadUserId, maxOpen: t.maxOpen, active: t.active, categoryIds: t.categories.map((c) => c.id), assignmentMethod: (t.assignmentMethod as Method) ?? "MANUAL" } : NEW_CUSTOM);
        setLead(t?.leadName ?? null);
        setEdit({ open: true, team: t });
    };

    // ── members
    const [mem, setMem] = useState<{ open: boolean; team?: SettingsTeam; rows: MemberRow[] }>({ open: false, rows: [] });
    const openMembers = (t: SettingsTeam) => setMem({
        open: true, team: t,
        rows: t.members.filter((m) => m.active || (m.source === "DEPT" && m.excluded)).map((m) => ({ userId: m.userId, name: m.name, privilege: m.privilege, skills: m.skills, include: m.active, source: m.source })),
    });
    const setRow = (id: number, patch: Partial<MemberRow>) => setMem((x) => ({ ...x, rows: x.rows.map((r) => (r.userId === id ? { ...r, ...patch } : r)) }));

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button color="primary" startContent={<Building2 size={14} />} onPress={openAdd}>Add a department</Button>
                <p className="text-xs text-ink-500 dark:text-ink-400">Each team is a department or sub department you already have. Its people and leader come from there; nothing in Department Management changes.</p>
            </div>

            <ConfirmDelete title={del ? `Delete the team "${del.name}"?` : null} text="Its members are not affected; only the team is removed." busy={busy}
                onClose={() => setDel(null)} onConfirm={() => del && guard(() => ticketingApi.deleteTeam(del.id), "Team deleted", () => setDel(null))} />

            {!teams.length && <p className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-500 dark:border-white/15 dark:bg-ink-900">No departments yet. Add the departments and sub departments that will handle tickets.</p>}

            {teams.map((t) => {
                const active = t.members.filter((m) => m.active);
                return (
                    <Panel key={t.id} title={<span className="flex flex-wrap items-center gap-3">{t.name}
                        {t.departmentId ? <Chip size="sm" variant="flat" startContent={<Building2 size={11} />}>{t.primaryDepartmentName ? `${t.primaryDepartmentName} › ` : ""}{t.departmentName}</Chip> : <Chip size="sm" color="warning" variant="flat">Old custom team: not offered on the form</Chip>}
                        {!t.active && <Chip size="sm" color="warning" variant="flat">Inactive</Chip>}</span>}
                        actions={<div className="flex gap-2">
                            {t.departmentId != null && <Button size="sm" variant="light" startContent={<RefreshCw size={13} />} isLoading={busy} onPress={() => guard(() => ticketingApi.syncTeam(t.id), "Team updated from its department")}>Update from department</Button>}
                            <Button size="sm" variant="bordered" startContent={<Pencil size={13} />} onPress={() => openEdit(t)}>Edit</Button>
                            <Button size="sm" variant="light" color="danger" startContent={<Trash2 size={13} />} isLoading={busy}
                                onPress={() => setDel({ id: t.id, name: t.name })}>Delete</Button>
                            <Button size="sm" variant="bordered" startContent={<Users size={13} />} onPress={() => openMembers(t)}>Members ({active.length})</Button></div>}>
                        <p className="mb-3 text-sm text-ink-600 dark:text-ink-300">
                            Lead: <b>{t.leadName ?? "none"}</b>{t.departmentId != null && t.leadName && <span className="text-xs text-ink-500"> ({t.leadLocked ? "picked by hand" : "the department's leader"})</span>}
                            {" · "}{METHODS.find((m) => m.key === t.assignmentMethod)?.label ?? t.assignmentMethod} · up to {t.maxOpen} open per agent · {t.openTickets} open tickets
                            
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {active.map((m) => <Chip key={m.userId} size="sm" variant="bordered">{m.name} · {PRIVILEGE_LABEL[m.privilege]}{m.skills.length ? ` · ${m.skills.join(", ")}` : ""}</Chip>)}
                            {!active.length && <span className="text-sm text-ink-500">No members yet.</span>}
                        </div>
                    </Panel>
                );
            })}

            {/* Add from a department */}
            <Drawer isOpen={add.open} onOpenChange={(o) => { if (!o) setAdd((a) => ({ ...a, open: false })); }} size="xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Teams</span><span>Add a team from a department</span></DrawerHeader>
                    <DrawerBody className="gap-4">
                        <p className="text-sm text-ink-500 dark:text-ink-400">Choose the sub department that will handle tickets. Its people become the team and its leader the team lead. You see the sub departments you lead (Executive or Functional Leader) or where people report to you; admins see all.</p>
                        <Input size="sm" aria-label="Search" placeholder="Search a department or sub department" value={add.q} onValueChange={(v) => setAdd((a) => ({ ...a, q: v }))} />
                        {add.tree === null ? <p className="text-sm text-ink-500">Loading…</p> : !shown.length ? (
                            <p className="border border-dashed border-ink-300 p-6 text-center text-sm text-ink-500 dark:border-white/15">{flat.length ? "Nothing matches your search." : "You do not lead or manage any sub department yet, so there is nothing to choose from."}</p>
                        ) : shown.map((d) => (
                            <div key={d.id} className="flex flex-col gap-1.5">
                                <span className="eyebrow">{d.name}</span>
                                <div className="divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                                    {d.subDepartments.map((x) => (
                                        <button key={x.id} type="button" disabled={x.teamId != null} aria-pressed={add.subId === x.id} onClick={() => setAdd((a) => ({ ...a, subId: x.id, name: x.isWhole ? d.name : x.name }))}
                                            className={cn("flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
                                                add.subId === x.id ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-ink-50 dark:hover:bg-white/5")}>
                                            <span className="font-semibold text-ink-900 dark:text-white">{x.name}</span>
                                            <span className="text-xs text-ink-500 dark:text-ink-400">
                                                {x.people} {x.people === 1 ? "person" : "people"} · lead {x.leadName ?? "none"}
                                                {x.relation === "MANAGER" ? ` · ${x.reportCount} ${x.reportCount === 1 ? "person reports" : "people report"} to you` : x.relation ? ` · ${RELATION[x.relation]}` : ""}
                                                {x.teamId ? " · already a team" : ""}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {sub && (
                            <div className="flex flex-col gap-3 border border-dashed border-brand-400 p-4">
                                <Input label="Team name" labelPlacement="outside" value={add.name} onValueChange={(v) => setAdd((a) => ({ ...a, name: v }))} description="What people see on tickets; you can change it later" />
                                <p className="text-sm text-ink-700 dark:text-ink-200">{sub.people} {sub.people === 1 ? "person becomes a member" : "people become members"}; the lead is <b>{sub.leadName ?? "nobody (the sub department has no leader; you can pick one after)"}</b>.
                                    New people who join the sub department are added automatically, and people who leave are removed.</p>
                            </div>
                        )}
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setAdd((a) => ({ ...a, open: false }))}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!sub || !add.name.trim()} onPress={() => guard(() => ticketingApi.teamFromDepartment(add.subId!, add.name.trim()), "Team added", () => setAdd((a) => ({ ...a, open: false })))}>Add team</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            {/* Edit / custom team */}
            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="lg">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Teams</span><span>Edit {edit.team?.name}</span></DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Input label="Name" labelPlacement="outside" value={draft.name} onValueChange={(v) => setDraft((d) => ({ ...d, name: v }))} isRequired />
                        <div className="flex flex-col gap-2">
                            <span className="eyebrow">Team lead</span>
                            <p className="text-sm">{lead ? <b>{lead}</b> : <span className="text-ink-500">Nobody yet</span>}
                                {edit.team?.departmentId != null && <span className="text-xs text-ink-500"> ({edit.team.leadLocked ? "picked by hand" : "the department's leader"})</span>}</p>
                            <UserPicker label={edit.team?.departmentId != null ? "Pick another lead (instead of the department's leader)" : "Choose the lead (assigns tickets; added as a member)"} onPick={(u) => { setDraft((d) => ({ ...d, leadUserId: u.id, useDepartmentLead: false })); setLead(u.name); }} />
                            {edit.team?.departmentId != null && edit.team.leadLocked && (
                                <div><Button size="sm" variant="light" onPress={() => setDraft((d) => ({ ...d, useDepartmentLead: true }))}>{draft.useDepartmentLead ? "✓ Will use the department's leader again" : "Use the department's leader again"}</Button></div>
                            )}
                        </div>
                        <Select label="How tickets are assigned" labelPlacement="outside" selectedKeys={new Set([draft.assignmentMethod])} onSelectionChange={(k) => setDraft((d) => ({ ...d, assignmentMethod: String(Array.from(k)[0]) as Method }))}
                            description={METHODS.find((m) => m.key === draft.assignmentMethod)?.hint}>
                            {METHODS.map((m) => <SelectItem key={m.key}>{m.label}</SelectItem>)}
                        </Select>
                        <Input type="number" label="Most open tickets per agent" labelPlacement="outside" value={String(draft.maxOpen)} onValueChange={(v) => setDraft((d) => ({ ...d, maxOpen: Number(v) || 1 }))} description="Members at this limit are skipped by automatic assignment" />
                        <Switch isSelected={draft.active} onValueChange={(v) => setDraft((d) => ({ ...d, active: v }))}>Active</Switch>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!draft.name.trim()} onPress={() => guard(() => ticketingApi.saveTeam(draft, edit.team?.id), "Team saved", () => setEdit({ open: false }))}>Save team</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            {/* Members */}
            <Drawer isOpen={mem.open} onOpenChange={(o) => { if (!o) setMem({ open: false, rows: [] }); }} size="xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Members</span><span>{mem.team?.name}</span></DrawerHeader>
                    <DrawerBody className="gap-4">
                        {mem.team?.departmentId != null && <p className="text-sm text-ink-500 dark:text-ink-400">These are the people of the sub department. Switch someone off to keep them out of ticketing (they stay in the department). Add anyone from another department below.</p>}
                        <div className="divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                            {mem.rows.map((m) => {
                                const isLead = m.userId === mem.team?.leadUserId;
                                return (
                                    <div key={m.userId} className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-2.5", !m.include && "opacity-60")}>
                                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{m.name}
                                            {isLead && <Chip size="sm" color="primary" variant="flat">Team lead</Chip>}
                                            {m.source === "MANUAL" && !isLead && <Chip size="sm" variant="bordered">Added by hand</Chip>}</span>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Input aria-label="Skills" size="sm" className="w-44" placeholder="Skills, e.g. VPN" value={m.skills.join(", ")} onValueChange={(v) => setRow(m.userId, { skills: v.split(",").map((q) => q.trim()) })} />
                                            <Select aria-label="Privilege" size="sm" className="w-44" isDisabled={isLead} selectedKeys={new Set([isLead ? "LEAD" : m.privilege])} onSelectionChange={(k) => setRow(m.userId, { privilege: String(Array.from(k)[0]) as Privilege })}>
                                                {(["BASIC", "SENIOR", ...(isLead ? ["LEAD"] : []), "SUPERVISOR"] as Privilege[]).map((p) => <SelectItem key={p}>{PRIVILEGE_LABEL[p]}</SelectItem>)}
                                            </Select>
                                            {m.source === "DEPT" || isLead
                                                ? <Switch size="sm" isDisabled={isLead} isSelected={m.include} onValueChange={(v) => setRow(m.userId, { include: v })}>In ticketing</Switch>
                                                : <Button isIconOnly size="sm" variant="light" aria-label="Remove" onPress={() => setMem((x) => ({ ...x, rows: x.rows.filter((r) => r.userId !== m.userId) }))}><Trash2 size={14} /></Button>}
                                        </div>
                                    </div>
                                );
                            })}
                            {!mem.rows.length && <p className="px-4 py-3 text-sm text-ink-500">No members.</p>}
                        </div>
                        <UserPicker label="Add someone from another department" onPick={(u) => setMem((x) => (x.rows.some((r) => r.userId === u.id) ? x : { ...x, rows: [...x.rows, { userId: u.id, name: u.name, privilege: "BASIC", skills: [], include: true, source: "MANUAL" }] }))} />
                        <p className="text-xs text-ink-500 dark:text-ink-400">Basic: works tickets assigned to them. Senior: also takes tickets from the team list, hands over, transfers to another team. Team lead: assigns anyone, moves tickets between groups, closes. Skills matter for teams that assign by skill.</p>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setMem({ open: false, rows: [] })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} onPress={() => guard(() => ticketingApi.setMembers(mem.team!.id, mem.rows.map((m) => ({ userId: m.userId, privilege: m.privilege, active: m.include, skills: m.skills.filter(Boolean) }))), "Members saved", () => setMem({ open: false, rows: [] }))}>Save members</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
