import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Pencil, Plus, Search } from "lucide-react";

import { PageHeader, Panel } from "@/components/page";
import { Button, Chip, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Select, SelectItem, Switch, addToast } from "@/components/ui";
import { Field, Section } from "@/components/Field";
import { hasModuleAccess } from "@/lib/auth";
import { NAME_HINT, nameProblem } from "@/lib/names";

interface U { userId: number; name: string; email: string; active: boolean; roleId: number; roleName: string; twoFactor: boolean | null; teams: { id: number; name: string }[]; leadOf: number[]; hasPassword: boolean; mustChange: boolean }
interface T { id: number; name: string }
interface Saved { userId: number; passwordSent: boolean; emailed: boolean; tempPassword?: string }
interface R { roleId: number; roleName: string }
const msg = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";
const DEFAULT = "_default", ON = "on", OFF = "off", ALL = "_all", PAGE = 20;
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Users: add people, give each one role, and choose whether they sign in with a code. */
export default function UsersPage() {
    const [users, setUsers] = useState<U[]>([]);
    const [roles, setRoles] = useState<R[]>([]);
    const [teams, setTeams] = useState<T[]>([]);
    const [sent, setSent] = useState<{ name: string; email: string; saved: Saved } | null>(null);
    const [defaultOn, setDefaultOn] = useState(true);
    const [edit, setEdit] = useState<{ open: boolean; id?: number }>({ open: false });
    const [f, setF] = useState({ name: "", email: "", roleId: 0, active: true, resetPassword: false, twoFactor: DEFAULT, teamIds: [] as string[], leadIds: [] as string[] });
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState("");
    const [fRole, setFRole] = useState("");
    const [fTeam, setFTeam] = useState("");
    const [fState, setFState] = useState("");
    const [page, setPage] = useState(1);
    const canWrite = hasModuleAccess("adm_users", "update");

    const load = useCallback(() => {
        axios.get("/api/admin/users").then((r) => setUsers(r.data.response)).catch((e) => addToast({ title: "Could not load users", description: msg(e), color: "danger" }));
        axios.get("/api/admin/roles").then((r) => setRoles(r.data.response)).catch(() => undefined);
        axios.get("/api/admin/teams").then((r) => setTeams(r.data.response)).catch(() => undefined);
        axios.get("/api/admin/two-factor").then((r) => setDefaultOn(r.data.response.on)).catch(() => undefined);
    }, []);
    useEffect(load, [load]);

    const open = (u?: U) => { setF({ name: u?.name ?? "", email: u?.email ?? "", roleId: u?.roleId ?? 0, active: u?.active ?? true, resetPassword: false, twoFactor: u?.twoFactor == null ? DEFAULT : u.twoFactor ? ON : OFF, teamIds: (u?.teams ?? []).map((t) => String(t.id)), leadIds: (u?.leadOf ?? []).map(String) }); setEdit({ open: true, id: u?.userId }); };
    const save = async () => {
        setBusy(true);
        try {
            const body = { name: f.name, email: f.email, roleId: f.roleId, active: f.active, twoFactor: f.twoFactor === DEFAULT ? null : f.twoFactor === ON, teamIds: f.teamIds.map(Number), leadTeamIds: f.leadIds.filter((id) => f.teamIds.includes(id)).map(Number), ...(edit.id && f.resetPassword ? { resetPassword: true } : {}) };
            const saved: Saved = (edit.id ? await axios.put(`/api/admin/users/${edit.id}`, body) : await axios.post("/api/admin/users", body)).data.response;
            addToast({ title: saved.passwordSent ? (saved.emailed ? `Saved. A temporary password was emailed to ${f.email}` : "Saved") : "Person saved", color: "success" });
            if (saved.passwordSent && !saved.emailed) setSent({ name: f.name, email: f.email, saved });
            setEdit({ open: false }); load();
        } catch (e) { addToast({ title: "Not saved", description: msg(e), color: "danger" }); } finally { setBusy(false); }
    };
    const setDefault = async (on: boolean) => {
        try { await axios.put("/api/admin/two-factor", { on }); setDefaultOn(on); addToast({ title: on ? "Everyone signs in with a code unless set otherwise" : "Code sign-in is off unless set per person", color: "success" }); }
        catch (e) { addToast({ title: "Not changed", description: msg(e), color: "danger" }); }
    };
    const needle = q.trim().toLowerCase();
    const shown = users.filter((u) => (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
        && (!fRole || String(u.roleId) === fRole) && (!fTeam || u.teams.some((t) => String(t.id) === fTeam))
        && (!fState || (fState === "nopw" ? !u.hasPassword : fState === "temp" ? u.hasPassword && u.mustChange : !u.active)));
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    const pageRows = shown.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
    const ready = !!f.name.trim() && !nameProblem("person", f.name) && /\S+@\S+\.\S+/.test(f.email) && f.roleId > 0 && true;

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Users" subtitle="The people who can sign in to this tool. Each has one role.">
                {hasModuleAccess("adm_users", "create") && <Button color="primary" startContent={<Plus size={14} />} onPress={() => open()}>New user</Button>}
            </PageHeader>
            <Panel title="Two-step sign-in">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-xl text-sm text-ink-600 dark:text-ink-300">After the password, a 6-digit code is emailed. This is the default for everyone; a person can be set to always or never need it.</p>
                    <Switch isSelected={defaultOn} isDisabled={!canWrite} onValueChange={setDefault}>Code sign-in for everyone by default</Switch>
                </div>
            </Panel>
            <Panel title="People">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <Input size="sm" className="w-72" aria-label="Search people" placeholder="Search by name or email" startContent={<Search size={14} className="text-ink-400" />} value={q} onValueChange={(v) => { setQ(v); setPage(1); }} isClearable onClear={() => setQ("")} />
                        <Select size="sm" className="w-44" aria-label="Role" selectedKeys={new Set([fRole || ALL])} onSelectionChange={(k) => { const v = String(Array.from(k)[0] ?? ALL); setFRole(v === ALL ? "" : v); setPage(1); }}>
                            {[{ key: ALL, name: "All roles" }, ...roles.map((r) => ({ key: String(r.roleId), name: r.roleName }))].map((o) => <SelectItem key={o.key}>{o.name}</SelectItem>)}
                        </Select>
                        <Select size="sm" className="w-48" aria-label="Team" selectedKeys={new Set([fTeam || ALL])} onSelectionChange={(k) => { const v = String(Array.from(k)[0] ?? ALL); setFTeam(v === ALL ? "" : v); setPage(1); }}>
                            {[{ key: ALL, name: "All teams" }, ...teams.map((t) => ({ key: String(t.id), name: t.name.trim() }))].map((o) => <SelectItem key={o.key}>{o.name}</SelectItem>)}
                        </Select>
                        <Select size="sm" className="w-48" aria-label="State" selectedKeys={new Set([fState || ALL])} onSelectionChange={(k) => { const v = String(Array.from(k)[0] ?? ALL); setFState(v === ALL ? "" : v); setPage(1); }}>
                            {[{ key: ALL, name: "Anyone" }, { key: "nopw", name: "No password yet" }, { key: "temp", name: "On a temporary password" }, { key: "off", name: "Switched off" }].map((o) => <SelectItem key={o.key}>{o.name}</SelectItem>)}
                        </Select>
                        {(q || fRole || fTeam || fState) && <Button size="sm" variant="light" onPress={() => { setQ(""); setFRole(""); setFTeam(""); setFState(""); setPage(1); }}>Clear</Button>}
                        <span className="ml-auto pb-1 text-xs text-ink-500">{shown.length} of {users.length} people</span>
                    </div>

                    {!shown.length ? <p className="py-8 text-center text-sm text-ink-500">Nobody matches this search.</p> : (
                        <ul className="divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                            {pageRows.map((u) => (
                                <li key={u.userId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(220px,1.3fr)_110px_minmax(0,1.6fr)_150px_70px]">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center bg-brand-50 text-xs font-extrabold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{initials(u.name)}</span>
                                        <div className="min-w-0"><p className="truncate text-sm font-bold">{u.name || "Unnamed"}</p><p className="truncate text-xs text-ink-500">{u.email}</p></div>
                                    </div>
                                    <div className="order-3 lg:order-none"><Chip size="sm" variant="flat">{u.roleName}</Chip></div>
                                    <div className="order-4 col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 lg:order-none lg:col-span-1">
                                        {u.teams.length === 0 && <span className="text-xs text-ink-400">No team</span>}
                                        {u.teams.slice(0, 2).map((t) => <span key={t.id} className="max-w-[200px] truncate border border-ink-200 px-2 py-0.5 text-xs dark:border-white/15" title={t.name}>{t.name.trim()}{u.leadOf.includes(t.id) ? " (lead)" : ""}</span>)}
                                        {u.teams.length > 2 && <span className="cursor-default border border-ink-200 px-2 py-0.5 text-xs font-semibold dark:border-white/15" title={u.teams.slice(2).map((t) => t.name.trim()).join(", ")}>+{u.teams.length - 2} more</span>}
                                    </div>
                                    <div className="order-2 flex flex-col items-end gap-1 lg:order-none lg:items-start">
                                        {!u.active ? <Chip size="sm" color="warning" variant="flat">Switched off</Chip>
                                            : !u.hasPassword ? <Chip size="sm" color="warning" variant="flat">No password yet</Chip>
                                                : u.mustChange ? <Chip size="sm" color="primary" variant="flat">Temporary password</Chip>
                                                    : <Chip size="sm" color="success" variant="flat">Active</Chip>}
                                        <span className="text-[11px] text-ink-500">Code sign-in: {u.twoFactor == null ? `default (${defaultOn ? "on" : "off"})` : u.twoFactor ? "always" : "never"}</span>
                                    </div>
                                    <div className="order-5 col-span-2 text-right lg:order-none lg:col-span-1">{canWrite && <Button size="sm" variant="bordered" startContent={<Pencil size={13} />} onPress={() => open(u)}>Edit</Button>}</div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {shown.length > PAGE && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-500">{(page - 1) * PAGE + 1} to {Math.min(page * PAGE, shown.length)} of {shown.length}</span>
                            <div className="flex gap-2"><Button size="sm" variant="bordered" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="bordered" isDisabled={page >= pages} onPress={() => setPage(page + 1)}>Next</Button></div>
                        </div>
                    )}
                </div>
            </Panel>

            {sent && (
                <div role="alert" className="border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="font-bold">The email could not be sent (no mail server is set up), so here is the temporary password for {sent.name} ({sent.email}):</p>
                    <p className="my-2 select-all text-lg font-bold tracking-wider">{sent.saved.tempPassword}</p>
                    <p>Pass it on yourself. It is shown only now and only in development; on a live server the mail server is required. They must change it at their first sign-in.</p>
                    <Button size="sm" className="mt-2" variant="bordered" onPress={() => setSent(null)}>Done</Button>
                </div>
            )}
            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="md">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Users</span><span>{edit.id ? "Edit person" : "New user"}</span></DrawerHeader>
                    <DrawerBody className="gap-6">
                        <Section title="Who">
                            <Field label="Full name" required hint={nameProblem("person", f.name) ? null : NAME_HINT.person} error={nameProblem("person", f.name)}>
                                <Input aria-label="Full name" placeholder="e.g. Anita Rao" value={f.name} onValueChange={(v) => setF((x) => ({ ...x, name: v }))} maxLength={80} isInvalid={!!nameProblem("person", f.name)} />
                            </Field>
                            <Field label="Email" required hint="They sign in with this address, and the temporary password and the sign-in code are sent here.">
                                <Input type="email" aria-label="Email" placeholder="name@company.com" value={f.email} onValueChange={(v) => setF((x) => ({ ...x, email: v }))} />
                            </Field>
                        </Section>

                        <Section title="Access">
                            <Field label="Role" required hint="What this person may do. Roles are made under Roles.">
                                <Select aria-label="Role" placeholder="Choose a role" selectedKeys={f.roleId ? new Set([String(f.roleId)]) : new Set<string>()} onSelectionChange={(k) => setF((x) => ({ ...x, roleId: Number(Array.from(k)[0]) || 0 }))}>
                                    {roles.map((r) => <SelectItem key={String(r.roleId)}>{r.roleName}</SelectItem>)}
                                </Select>
                            </Field>
                            <Field label="Code sign-in" hint="Ask for a 6-digit emailed code after the password.">
                                <Select aria-label="Code sign-in" selectedKeys={new Set([f.twoFactor])} onSelectionChange={(k) => setF((x) => ({ ...x, twoFactor: String(Array.from(k)[0] ?? DEFAULT) }))}>
                                    <SelectItem key={DEFAULT}>{`Follow the default (${defaultOn ? "on" : "off"})`}</SelectItem><SelectItem key={ON}>Always ask for a code</SelectItem><SelectItem key={OFF}>Never ask for a code</SelectItem>
                                </Select>
                            </Field>
                            <Switch isSelected={f.active} onValueChange={(v) => setF((x) => ({ ...x, active: v }))}>Can sign in</Switch>
                        </Section>

                        <Section title="Teams">
                            <Field label="Works in" hint={teams.length ? "They can be given the tickets of these teams." : "There are no teams yet. Create one under Teams first."}>
                                <Select aria-label="Teams this person works in" selectionMode="multiple" placeholder="Choose teams" isDisabled={!teams.length}
                                    selectedKeys={new Set(f.teamIds)} onSelectionChange={(k) => setF((x) => { const ids = Array.from(k).map(String); return { ...x, teamIds: ids, leadIds: x.leadIds.filter((id) => ids.includes(id)) }; })}>
                                    {teams.map((t) => <SelectItem key={String(t.id)}>{t.name}</SelectItem>)}
                                </Select>
                            </Field>
                            <Field label="Team lead of" hint="Optional. A lead assigns the team's tickets. A team has one lead, so choosing it here replaces the old one.">
                                <Select aria-label="Teams this person leads" selectionMode="multiple" placeholder={f.teamIds.length ? "Choose teams" : "Choose the teams above first"} isDisabled={!f.teamIds.length}
                                    selectedKeys={new Set(f.leadIds)} onSelectionChange={(k) => setF((x) => ({ ...x, leadIds: Array.from(k).map(String) }))}>
                                    {teams.filter((t) => f.teamIds.includes(String(t.id))).map((t) => <SelectItem key={String(t.id)}>{t.name}</SelectItem>)}
                                </Select>
                            </Field>
                        </Section>

                        <Section title="Password">
                            {!edit.id
                                ? <p className="border border-ink-200 bg-ink-50 p-3 text-sm leading-snug text-ink-600 dark:border-white/10 dark:bg-white/5 dark:text-ink-300">A temporary password is generated and emailed to this address. The person must choose their own password the first time they sign in.</p>
                                : <Switch isSelected={f.resetPassword} onValueChange={(v) => setF((x) => ({ ...x, resetPassword: v }))}>Send a new temporary password</Switch>}
                            {edit.id && <p className="-mt-2 text-xs text-ink-500">They must change it at their next sign-in.</p>}
                        </Section>
                    </DrawerBody>
                    <DrawerFooter><Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button><Button color="primary" isLoading={busy} isDisabled={!ready} onPress={save}>Save</Button></DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
