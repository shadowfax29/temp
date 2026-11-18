import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader, Panel } from "@/components/page";
import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Switch, Textarea, addToast } from "@/components/ui";
import { ConfirmDelete } from "@/components/ticketing/parts";
import { Field } from "@/components/Field";
import { hasModuleAccess } from "@/lib/auth";
import { NAME_HINT, nameProblem } from "@/lib/names";

type Action = "read" | "create" | "update" | "delete";
const ACTIONS: { key: Action; label: string }[] = [{ key: "read", label: "View" }, { key: "create", label: "Create" }, { key: "update", label: "Edit" }, { key: "delete", label: "Delete" }];
interface ModuleDef { id: string; label: string; description: string; actions?: Action[]; children?: ModuleDef[] }
interface Role { roleId: number; roleName: string; description: string; active: boolean; system: boolean; userCount: number; privileges: Record<string, Action[]> }
const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";
const api = (p: string) => `/api/admin${p}`;

/** Roles: the permission checklist. Ticking Create, Edit or Delete also ticks View. */
export default function RolesPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [catalog, setCatalog] = useState<ModuleDef[]>([]);
    const [edit, setEdit] = useState<{ open: boolean; id?: number; system?: boolean }>({ open: false });
    const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [active, setActive] = useState(true);
    const [privs, setPrivs] = useState<Record<string, Action[]>>({});
    const [del, setDel] = useState<Role | null>(null);
    const [busy, setBusy] = useState(false);
    const canWrite = hasModuleAccess("adm_roles", "update");

    const load = useCallback(() => {
        axios.get(api("/roles")).then((r) => setRoles(r.data.response)).catch((e) => addToast({ title: "Could not load roles", description: msg(e), color: "danger" }));
    }, []);
    useEffect(() => { load(); axios.get("/api/auth/catalog").then((r) => setCatalog(r.data.response)).catch(() => undefined); }, [load]);

    const open = (r?: Role) => { setName(r?.roleName ?? ""); setDesc(r?.description ?? ""); setActive(r?.active ?? true); setPrivs(r ? structuredClone(r.privileges) : {}); setEdit({ open: true, id: r?.roleId, system: r?.system }); };
    const toggle = (m: string, a: Action) => setPrivs((p) => {
        const cur = new Set(p[m] ?? []);
        if (cur.has(a)) { cur.delete(a); if (a === "read") cur.clear(); } else { cur.add(a); if (a !== "read") cur.add("read"); }
        const next = { ...p }; if (cur.size) next[m] = ACTIONS.map((x) => x.key).filter((k) => cur.has(k)); else delete next[m];
        return next;
    });
    const save = async () => {
        setBusy(true);
        try {
            const body = { roleName: name, description: desc, active, privileges: privs };
            if (edit.id) await axios.put(api(`/roles/${edit.id}`), body); else await axios.post(api("/roles"), body);
            addToast({ title: "Role saved", color: "success" }); setEdit({ open: false }); load();
        } catch (e) { addToast({ title: "Not saved", description: msg(e), color: "danger" }); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!del) return; setBusy(true);
        try { await axios.delete(api(`/roles/${del.roleId}`)); addToast({ title: "Role deleted", color: "success" }); setDel(null); load(); }
        catch (e) { addToast({ title: "Not deleted", description: msg(e), color: "danger" }); } finally { setBusy(false); }
    };

    const allowed = (m: ModuleDef) => m.actions ?? ACTIONS.map((x) => x.key);
    /** Ticks or clears every action of every permission inside a group */
    const setGroup = (g: ModuleDef, on: boolean) => setPrivs((p) => {
        const next = { ...p };
        for (const m of g.children ?? []) { if (on) next[m.id] = allowed(m); else delete next[m.id]; }
        return next;
    });
    const groupFull = (g: ModuleDef) => (g.children ?? []).every((m) => allowed(m).every((a) => privs[m.id]?.includes(a)));

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Roles" subtitle="A role is a set of ticks. Give each person one role; they can do exactly what it ticks.">
                {hasModuleAccess("adm_roles", "create") && <Button color="primary" startContent={<Plus size={14} />} onPress={() => open()}>New role</Button>}
            </PageHeader>
            <div className="grid gap-4 md:grid-cols-2">
                {roles.map((r) => (
                    <Panel key={r.roleId} title={<span className="flex flex-wrap items-center gap-2">{r.roleName}{r.system && <Chip size="sm" variant="flat">Everything</Chip>}{!r.active && <Chip size="sm" color="warning" variant="flat">Off</Chip>}</span>}
                        actions={<div className="flex gap-1">
                            {!r.system && <Button size="sm" variant="bordered" startContent={<Pencil size={13} />} onPress={() => open(r)}>Edit</Button>}
                            {!r.system && hasModuleAccess("adm_roles", "delete") && <Button size="sm" variant="light" color="danger" startContent={<Trash2 size={13} />} onPress={() => setDel(r)}>Delete</Button>}
                        </div>}>
                        <p className="text-sm text-ink-600 dark:text-ink-300">{r.description || "No description."}</p>
                        <p className="mt-2 text-xs text-ink-500">{r.userCount} {r.userCount === 1 ? "person" : "people"} · {r.system ? "all permissions" : `${Object.keys(r.privileges).filter((k) => !catalog.some((c) => c.id === k)).length} permissions`}</p>
                    </Panel>
                ))}
            </div>

            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="3xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Roles</span><span>{edit.id ? "Edit role" : "New role"}</span></DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Field label="Name" required hint={nameProblem("role", name) ? null : NAME_HINT.role} error={nameProblem("role", name)}>
                            <Input aria-label="Role name" placeholder="e.g. Support Agent" value={name} onValueChange={setName} maxLength={60} isInvalid={!!nameProblem("role", name)} />
                        </Field>
                        <Field label="What is it for?" hint="One line that tells an admin when to give this role.">
                            <Textarea aria-label="What the role is for" minRows={2} value={desc} onValueChange={setDesc} />
                        </Field>
                        <Switch isSelected={active} onValueChange={setActive}>Role is on</Switch>
                        <div>
                            <p className="eyebrow mb-2">What this role can do</p>
                            {edit.system && <p className="mb-2 text-sm text-ink-500">This role always has everything and cannot be changed.</p>}
                            <div className="border border-ink-200 dark:border-white/10">
                                <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_repeat(4,56px)] items-center border-b border-ink-200 bg-ink-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-500 dark:border-white/10 dark:bg-ink-800">
                                    <span>Permission</span>{ACTIONS.map((a) => <span key={a.key} className="text-center">{a.label}</span>)}
                                </div>
                                {catalog.map((g) => (
                                    <div key={g.id}>
                                        <div className="flex items-start justify-between gap-3 border-b border-ink-100 bg-white px-3 py-2.5 dark:border-white/5 dark:bg-ink-900">
                                            <div className="min-w-0"><p className="text-sm font-extrabold">{g.label}</p><p className="text-xs text-ink-500">{g.description}</p></div>
                                            {!edit.system && canWrite && <Button size="sm" variant="flat" onPress={() => setGroup(g, !groupFull(g))}>{groupFull(g) ? "Clear all" : "Tick all"}</Button>}
                                        </div>
                                        {(g.children ?? []).map((m) => (
                                            <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_repeat(4,56px)] items-center border-b border-ink-100 px-3 py-2.5 last:border-b-0 hover:bg-ink-50/60 dark:border-white/5 dark:hover:bg-white/5">
                                                <div className="min-w-0 pr-3"><p className="text-sm font-semibold">{m.label}</p><p className="text-xs text-ink-500">{m.description}</p></div>
                                                {ACTIONS.map((a) => (
                                                    <span key={a.key} className="flex justify-center">
                                                        {allowed(m).includes(a.key)
                                                            ? <input type="checkbox" aria-label={`${m.label}: ${a.label}`} className="h-[18px] w-[18px] cursor-pointer accent-[var(--heroui-primary,#ea580c)] disabled:cursor-not-allowed"
                                                                disabled={edit.system || !canWrite} checked={edit.system || (privs[m.id]?.includes(a.key) ?? false)} onChange={() => toggle(m.id, a.key)} />
                                                            : <span className="text-ink-300" aria-hidden="true">–</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!name.trim() || !!nameProblem("role", name)} onPress={save}>Save role</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
            <ConfirmDelete title={del ? `Delete the role "${del.roleName}"?` : null} text="This cannot be undone. A role that people still have cannot be deleted." busy={busy} onClose={() => setDel(null)} onConfirm={remove} />
        </div>
    );
}
