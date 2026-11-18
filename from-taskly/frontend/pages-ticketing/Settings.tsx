import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Plus, Trash2 } from "lucide-react";
import { cn } from "@heroui/theme";

import { PageHeader, Panel, Segmented } from "@/components/page";
import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Select, SelectItem, Switch, Textarea, addToast } from "@/components/ui";
import {
    PRIORITIES, PRIORITY_LABEL, errorText, ticketingApi,
    type CategoryDraft, type Cond, type CondType, type FieldDef, type FieldType, type RouteTest, type RuleDraft, type SettingsCategory, type SettingsTeam,
} from "@/components/ticketing/api";
import { ConfirmDelete, UserPicker } from "@/components/ticketing/parts";
import TeamsPanel from "@/components/ticketing/TeamsPanel";
import SetupOverview from "@/components/ticketing/SetupOverview";

const FIELD_TYPES: { key: FieldType; label: string }[] = [
    { key: "TEXT", label: "Short text" }, { key: "TEXTAREA", label: "Long text" }, { key: "NUMBER", label: "Number" }, { key: "SELECT", label: "Choose one" }, { key: "DATE", label: "Date" },
];

const Pick = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" aria-pressed={on} onClick={onClick}
        className={cn("border px-3 py-1.5 text-xs font-semibold transition-colors focus-ring", on ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 text-ink-700 hover:border-brand-500 dark:border-white/20 dark:text-ink-200")}>
        {children}
    </button>
);
const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const NEW_CAT: CategoryDraft = { name: "", prefix: "", description: "", ownerUserId: null, defaultTeamId: null, active: true, teamIds: [] };
const COND_TYPES: { key: CondType; label: string }[] = [
    { key: "field", label: "Form field" }, { key: "subcategory", label: "Ticket type" }, { key: "department", label: "Requester's department" }, { key: "priority", label: "Priority" },
];

type Tab = "overview" | "teams" | "categories" | "types";

export default function TicketingSettingsPage() {
    const [view, setView] = useState<Tab>("overview");
    const [cats, setCats] = useState<SettingsCategory[]>([]);
    const [teams, setTeams] = useState<SettingsTeam[]>([]);
    const load = useCallback(() => {
        ticketingApi.categories().then(setCats).catch((e) => addToast({ title: "Could not load groups", description: errorText(e), color: "danger" }));
        ticketingApi.teams().then(setTeams).catch((e) => addToast({ title: "Could not load teams", description: errorText(e), color: "danger" }));
    }, []);
    useEffect(load, [load]);

    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Ticketing settings" subtitle="Set up who handles tickets (departments and sub departments, taken from Department Management) and what people can ask for (ticket types and their forms)." />
            <Segmented label="Settings" value={view} onChange={setView} options={[{ key: "overview", label: "Setup guide" }, { key: "teams", label: `Teams (${teams.length})` }, { key: "types", label: `Ticket types (${cats.reduce((n, c) => n + c.subcategories.length, 0)})` }]} />
            {view === "overview" ? <SetupOverview teams={teams} cats={cats} go={setView} />
                : view === "teams" ? <TeamsPanel teams={teams} reload={load} />
                    : <Categories mode="types" cats={cats} teams={teams} reload={load} />}
        </div>
    );
}

// ── Categories ───────────────────────────────────────────────────────────────────────────────────

function Categories({ mode, cats, teams, reload }: { mode: "groups" | "types"; cats: SettingsCategory[]; teams: SettingsTeam[]; reload: () => void }) {
    const [edit, setEdit] = useState<{ open: boolean; id?: number; ticketCount?: number; ownerName?: string | null }>({ open: false });
    const [draft, setDraft] = useState<CategoryDraft>(NEW_CAT);
    const [sub, setSub] = useState<{ open: boolean; categoryId?: number; id?: number }>({ open: false });
    const [subDraft, setSubDraft] = useState<{ name: string; active: boolean; defaultTeamId: number | null; skill: string }>({ name: "", active: true, defaultTeamId: null, skill: "" });
    const [rules, setRules] = useState<{ open: boolean; cat?: SettingsCategory; list: RuleDraft[] }>({ open: false, list: [] });
    const [fields, setFields] = useState<{ open: boolean; subId?: number; title?: string; list: FieldDef[] }>({ open: false, list: [] });
    const [owner, setOwner] = useState<string | null>(null);
    const [delSub, setDelSub] = useState<{ id: number; name: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const guard = async (fn: () => Promise<unknown>, ok: string, done: () => void) => {
        setBusy(true);
        try { await fn(); addToast({ title: ok, color: "success" }); done(); reload(); }
        catch (e) { addToast({ title: "Not saved", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };

    const openCat = (c?: SettingsCategory) => {
        setDraft(c ? { name: c.name, prefix: c.prefix, description: c.description ?? "", ownerUserId: c.ownerUserId, defaultTeamId: c.defaultTeamId, active: c.active, teamIds: c.teams.map((t) => t.id) } : NEW_CAT);
        setOwner(c?.ownerName ?? null);
        setEdit({ open: true, id: c?.id, ticketCount: c?.ticketCount });
    };

    return (
        <div className="flex flex-col gap-4">
            <div>{mode === "groups"
                ? <Button color="primary" startContent={<Plus size={14} />} onPress={() => openCat()}>New group</Button>
                : <Button color="primary" startContent={<Plus size={14} />} onPress={() => { setSubDraft({ name: "", active: true, defaultTeamId: null, skill: "" }); setSub({ open: true, categoryId: 0 }); }}>New ticket type</Button>}</div>
            {mode === "groups" && !cats.length && <p className="border border-dashed border-ink-300 bg-white p-10 text-center text-sm text-ink-500 dark:border-white/15 dark:bg-ink-900">No groups yet. Add one, give it an owner and the teams that handle it.</p>}
            {mode === "types" && (
                <Panel title="Ticket types">
                    <div className="divide-y divide-ink-100 border border-ink-200 dark:divide-white/5 dark:border-white/10">
                        {cats.flatMap((c) => c.subcategories.map((s) => (
                            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                                <span className={cn("font-semibold", !s.active && "text-ink-400 line-through")}>{s.name}<span className="ml-3 text-xs font-normal text-ink-500">{[s.skill ? `skill ${s.skill}` : "", !s.active ? "hidden" : ""].filter(Boolean).join(" · ")}</span></span>
                                <span className="flex gap-2">
                                    <Button size="sm" variant="light" onPress={() => { setSubDraft({ name: s.name, active: s.active, defaultTeamId: s.defaultTeamId, skill: s.skill ?? "" }); setSub({ open: true, categoryId: c.id, id: s.id }); }}>Edit</Button>
                                    <Button size="sm" variant="light" color="danger" startContent={<Trash2 size={13} />} isLoading={busy}
                                        onPress={() => setDelSub({ id: s.id, name: s.name })}>Delete</Button>
                                </span>
                            </div>
                        )))}
                        {!cats.some((c) => c.subcategories.length) && <p className="px-4 py-3 text-sm text-ink-500">No ticket types yet. People cannot raise tickets until there is one.</p>}
                    </div>
                </Panel>
            )}
            <ConfirmDelete title={delSub ? `Delete the ticket type "${delSub.name}"?` : null} text="This cannot be undone. A type that tickets already use cannot be deleted." busy={busy}
                onClose={() => setDelSub(null)} onConfirm={() => delSub && guard(() => ticketingApi.deleteSub(delSub.id), "Ticket type deleted", () => setDelSub(null))} />

            <Drawer isOpen={edit.open} onOpenChange={(o) => { if (!o) setEdit({ open: false }); }} size="xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Ticketing</span><span>{edit.id ? "Edit group" : "New group"}</span></DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Input label="Name" labelPlacement="outside" placeholder="e.g. Ad Ops Requests" value={draft.name} onValueChange={(v) => setDraft((d) => ({ ...d, name: v }))} isRequired />
                        <Input label="Key prefix" labelPlacement="outside" placeholder="e.g. ADO" value={draft.prefix} onValueChange={(v) => setDraft((d) => ({ ...d, prefix: v.toUpperCase() }))} maxLength={8}
                            isDisabled={!!edit.ticketCount} description={edit.ticketCount ? "Cannot change once the group has tickets" : "Tickets are numbered ADO-1001, ADO-1002 …"} isRequired />
                        <Textarea label="What is it for?" labelPlacement="outside" minRows={2} value={draft.description} onValueChange={(v) => setDraft((d) => ({ ...d, description: v }))} />
                        <div className="flex flex-col gap-2">
                            <span className="eyebrow">Group owner</span>
                            <p className="text-sm">{owner ? <b>{owner}</b> : <span className="text-ink-500">Nobody yet</span>}</p>
                            <UserPicker label="Choose the owner (can route tickets in Triage)" onPick={(u) => { setDraft((d) => ({ ...d, ownerUserId: u.id })); setOwner(u.name); }} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="eyebrow">Teams that handle this group</span>
                            <div className="flex flex-wrap gap-2">{teams.map((t) => <Pick key={t.id} on={draft.teamIds.includes(t.id)} onClick={() => setDraft((d) => ({ ...d, teamIds: toggle(d.teamIds, t.id), defaultTeamId: d.defaultTeamId === t.id && d.teamIds.includes(t.id) ? null : d.defaultTeamId }))}>{t.name}</Pick>)}
                                {!teams.length && <span className="text-sm text-ink-500">Create a team first (Teams tab).</span>}</div>
                        </div>
                        <Select label="Default team" labelPlacement="outside" placeholder="None: tickets wait in Triage" selectedKeys={draft.defaultTeamId ? new Set([String(draft.defaultTeamId)]) : new Set<string>()}
                            onSelectionChange={(k) => setDraft((d) => ({ ...d, defaultTeamId: Number(Array.from(k)[0]) || null }))} description="New tickets of this group go to this team's queue">
                            {teams.filter((t) => draft.teamIds.includes(t.id)).map((t) => <SelectItem key={String(t.id)}>{t.name}</SelectItem>)}
                        </Select>
                        <Switch isSelected={draft.active} onValueChange={(v) => setDraft((d) => ({ ...d, active: v }))}>Open for new tickets</Switch>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setEdit({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!draft.name.trim() || draft.prefix.trim().length < 2}
                            onPress={() => guard(() => ticketingApi.saveCategory(draft, edit.id), "Group saved", () => setEdit({ open: false }))}>Save group</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <Drawer isOpen={sub.open} onOpenChange={(o) => { if (!o) setSub({ open: false }); }} size="sm">
                <DrawerContent>
                    <DrawerHeader>{sub.id ? "Edit ticket type" : "New ticket type"}</DrawerHeader>
                    <DrawerBody className="gap-5">
                        <Input label="Name" labelPlacement="outside" placeholder="e.g. Tag Request" value={subDraft.name} onValueChange={(v) => setSubDraft((d) => ({ ...d, name: v }))} isRequired />
                        <Input label="Skill needed" labelPlacement="outside" placeholder="e.g. VPN" value={subDraft.skill} onValueChange={(v) => setSubDraft((d) => ({ ...d, skill: v }))} description="Teams that assign by skill give it to members who have this skill" />
                        <Switch isSelected={subDraft.active} onValueChange={(v) => setSubDraft((d) => ({ ...d, active: v }))}>Shown on the new ticket form</Switch>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setSub({ open: false })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={!subDraft.name.trim()} onPress={() => guard(() => ticketingApi.saveSub(sub.categoryId!, { name: subDraft.name, active: subDraft.active, defaultTeamId: null, skill: subDraft.skill.trim() || null }, sub.id), "Ticket type saved", () => setSub({ open: false }))}>Save</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <Drawer isOpen={rules.open} onOpenChange={(o) => { if (!o) setRules({ open: false, list: [] }); }} size="4xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Routing rules</span><span>{rules.cat?.name}</span></DrawerHeader>
                    <DrawerBody className="gap-4">
                        <p className="text-sm text-ink-500 dark:text-ink-400">A new ticket is checked against these rules from the top; the first rule whose conditions all hold picks the team. If none does, the ticket type's default team is used, then the group's, then Triage.</p>
                        {rules.list.map((r, i) => {
                            const set = (patch: Partial<RuleDraft>) => setRules((x) => ({ ...x, list: x.list.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
                            const setCond = (ci: number, patch: Partial<Cond>) => set({ conditions: r.conditions.map((k, j) => (j === ci ? { ...k, ...patch } : k)) });
                            const fieldKeys = Array.from(new Set((rules.cat?.subcategories ?? []).flatMap((sc) => sc.fields.map((f) => f.key))));
                            const move = (d: number) => setRules((x) => { const l = [...x.list]; const j = i + d; if (j < 0 || j >= l.length) return x; [l[i], l[j]] = [l[j], l[i]]; return { ...x, list: l }; });
                            return (
                                <div key={i} className="flex flex-col gap-3 border border-ink-200 p-4 dark:border-white/10">
                                    <div className="flex flex-wrap items-end gap-3">
                                        <span className="pb-2 text-sm font-bold text-ink-500">{i + 1}</span>
                                        <Input className="min-w-[220px] flex-1" size="sm" label="Rule name" labelPlacement="outside" placeholder="e.g. Ad format is Video" value={r.name} onValueChange={(v) => set({ name: v })} />
                                        <Select className="w-56" size="sm" label="Send to team" labelPlacement="outside" selectedKeys={r.teamId ? new Set([String(r.teamId)]) : new Set<string>()} onSelectionChange={(k) => set({ teamId: Number(Array.from(k)[0]) || 0 })}>
                                            {(rules.cat?.teams ?? []).map((t) => <SelectItem key={String(t.id)}>{t.name}</SelectItem>)}
                                        </Select>
                                        <Switch size="sm" isSelected={r.active} onValueChange={(v) => set({ active: v })}>On</Switch>
                                        <Button isIconOnly size="sm" variant="light" aria-label="Move up" isDisabled={i === 0} onPress={() => move(-1)}><ArrowUp size={14} /></Button>
                                        <Button isIconOnly size="sm" variant="light" aria-label="Move down" isDisabled={i === rules.list.length - 1} onPress={() => move(1)}><ArrowDown size={14} /></Button>
                                        <Button isIconOnly size="sm" variant="light" aria-label="Remove rule" onPress={() => setRules((x) => ({ ...x, list: x.list.filter((_, j) => j !== i) }))}><Trash2 size={14} /></Button>
                                    </div>
                                    {r.conditions.map((k, ci) => (
                                        <div key={ci} className="flex flex-wrap items-end gap-2 pl-6">
                                            <span className="pb-2 text-xs font-bold uppercase text-ink-400">{ci === 0 ? "When" : "and"}</span>
                                            <Select className="w-52" size="sm" aria-label="Look at" selectedKeys={new Set([k.type])} onSelectionChange={(v) => setCond(ci, { type: String(Array.from(v)[0]) as CondType, key: undefined, value: "" })}>
                                                {COND_TYPES.map((t) => <SelectItem key={t.key}>{t.label}</SelectItem>)}
                                            </Select>
                                            {k.type === "field" && (
                                                <Select className="w-44" size="sm" aria-label="Field" placeholder="Which field" selectedKeys={k.key ? new Set([k.key]) : new Set<string>()} onSelectionChange={(v) => setCond(ci, { key: String(Array.from(v)[0] ?? "") })}>
                                                    {fieldKeys.map((f) => <SelectItem key={f}>{f}</SelectItem>)}
                                                </Select>
                                            )}
                                            <Select className="w-28" size="sm" aria-label="Is or is not" selectedKeys={new Set([k.op])} onSelectionChange={(v) => setCond(ci, { op: String(Array.from(v)[0]) as "is" | "is_not" })}>
                                                <SelectItem key="is">is</SelectItem><SelectItem key="is_not">is not</SelectItem>
                                            </Select>
                                            {k.type === "priority" ? (
                                                <Select className="w-40" size="sm" aria-label="Priority" selectedKeys={k.value ? new Set([k.value]) : new Set<string>()} onSelectionChange={(v) => setCond(ci, { value: String(Array.from(v)[0] ?? "") })}>
                                                    {PRIORITIES.map((p) => <SelectItem key={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                                                </Select>
                                            ) : k.type === "subcategory" ? (
                                                <Select className="w-52" size="sm" aria-label="Ticket type" selectedKeys={k.value ? new Set([k.value]) : new Set<string>()} onSelectionChange={(v) => setCond(ci, { value: String(Array.from(v)[0] ?? "") })}>
                                                    {(rules.cat?.subcategories ?? []).map((sc) => <SelectItem key={String(sc.id)}>{sc.name}</SelectItem>)}
                                                </Select>
                                            ) : (
                                                <Input className="w-52" size="sm" aria-label="Value" placeholder={k.type === "department" ? "Department ID" : "Value, e.g. Video"} value={k.value} onValueChange={(v) => setCond(ci, { value: v })} />
                                            )}
                                            <Button isIconOnly size="sm" variant="light" aria-label="Remove condition" isDisabled={r.conditions.length < 2} onPress={() => set({ conditions: r.conditions.filter((_, j) => j !== ci) })}><Trash2 size={13} /></Button>
                                        </div>
                                    ))}
                                    <div className="pl-6"><Button size="sm" variant="light" startContent={<Plus size={12} />} onPress={() => set({ conditions: [...r.conditions, { type: "field", op: "is", value: "" }] })}>Add condition</Button></div>
                                </div>
                            );
                        })}
                        <div><Button size="sm" variant="bordered" startContent={<Plus size={13} />} isDisabled={!(rules.cat?.teams.length)}
                            onPress={() => setRules((x) => ({ ...x, list: [...x.list, { name: "", conditions: [{ type: "field", op: "is", value: "" }], teamId: x.cat?.teams[0]?.id ?? 0, active: true }] }))}>Add rule</Button>
                            {!(rules.cat?.teams.length) && <span className="ml-3 text-xs text-ink-500">Give the group at least one team first.</span>}</div>
                        {rules.cat && <RouteTester cat={rules.cat} />}
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setRules({ open: false, list: [] })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={rules.list.some((r) => !r.name.trim() || !r.teamId || r.conditions.some((k) => !k.value.trim() || (k.type === "field" && !k.key)))}
                            onPress={() => guard(() => ticketingApi.setRules(rules.cat!.id, rules.list), "Routing rules saved", () => setRules({ open: false, list: [] }))}>Save rules</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <Drawer isOpen={fields.open} onOpenChange={(o) => { if (!o) setFields({ open: false, list: [] }); }} size="3xl">
                <DrawerContent>
                    <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Form fields</span><span>{fields.title}</span></DrawerHeader>
                    <DrawerBody className="gap-4">
                        <p className="text-sm text-ink-500 dark:text-ink-400">Subject, description and priority are always there. Add what the team needs to know for this kind of request.</p>
                        {fields.list.map((f, i) => {
                            const set = (patch: Partial<FieldDef>) => setFields((x) => ({ ...x, list: x.list.map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
                            return (
                                <div key={i} className="grid gap-3 border border-ink-200 p-3 dark:border-white/10 sm:grid-cols-[1fr_1fr_150px_auto]">
                                    <Input size="sm" label="Label" labelPlacement="outside" placeholder="Ad format" value={f.label} onValueChange={(v) => set({ label: v, key: f.key || v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) })} />
                                    <Input size="sm" label="Key" labelPlacement="outside" placeholder="ad_format" value={f.key} onValueChange={(v) => set({ key: v.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
                                    <Select size="sm" label="Type" labelPlacement="outside" selectedKeys={new Set([f.type])} onSelectionChange={(k) => set({ type: String(Array.from(k)[0]) as FieldType })}>
                                        {FIELD_TYPES.map((t) => <SelectItem key={t.key}>{t.label}</SelectItem>)}
                                    </Select>
                                    <div className="flex items-end gap-2 pb-1">
                                        <Switch size="sm" isSelected={f.required} onValueChange={(v) => set({ required: v })}>Required</Switch>
                                        <Button isIconOnly size="sm" variant="light" aria-label="Remove field" onPress={() => setFields((x) => ({ ...x, list: x.list.filter((_, j) => j !== i) }))}><Trash2 size={14} /></Button>
                                    </div>
                                    {f.type === "SELECT" && <div className="sm:col-span-4"><Input size="sm" label="Options (separated by commas)" labelPlacement="outside" placeholder="Video, Display, Native" value={f.options.join(", ")} onValueChange={(v) => set({ options: v.split(",").map((s) => s.trim()) })} /></div>}
                                </div>
                            );
                        })}
                        <div><Button size="sm" variant="bordered" startContent={<Plus size={13} />} onPress={() => setFields((x) => ({ ...x, list: [...x.list, { key: "", label: "", type: "TEXT", required: false, options: [] }] }))}>Add field</Button></div>
                    </DrawerBody>
                    <DrawerFooter>
                        <Button variant="light" onPress={() => setFields({ open: false, list: [] })}>Cancel</Button>
                        <Button color="primary" isLoading={busy} isDisabled={fields.list.some((f) => !f.label.trim() || !f.key.trim())}
                            onPress={() => guard(() => ticketingApi.setFields(fields.subId!, fields.list.map((f) => ({ ...f, options: f.options.filter(Boolean) }))), "Form saved", () => setFields({ open: false, list: [] }))}>Save form</Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}

/** "Test routing": answer the form as a requester would, see which team and person a ticket would get. Changes nothing. */
function RouteTester({ cat }: { cat: SettingsCategory }) {
    const [subId, setSubId] = useState<number | null>(cat.subcategories[0]?.id ?? null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [priority, setPriority] = useState("MEDIUM");
    const [dept, setDept] = useState("");
    const [res, setRes] = useState<RouteTest | null>(null);
    const [busy, setBusy] = useState(false);
    const sub = cat.subcategories.find((x) => x.id === subId);

    const run = async () => {
        if (!subId) return;
        setBusy(true);
        try { setRes(await ticketingApi.routeTest(cat.id, { subcategoryId: subId, fields: values, priority, departmentIds: dept.trim() ? dept.split(",").map((d) => Number(d.trim())).filter(Boolean) : [] })); }
        catch (e) { addToast({ title: "Test failed", description: errorText(e), color: "danger" }); }
        finally { setBusy(false); }
    };
    return (
        <div className="flex flex-col gap-3 border border-dashed border-brand-400 p-4">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-900 dark:text-white"><FlaskConical size={15} />Test routing (uses the saved rules)</p>
            <div className="flex flex-wrap items-end gap-3">
                <Select className="w-52" size="sm" label="Ticket type" labelPlacement="outside" selectedKeys={subId ? new Set([String(subId)]) : new Set<string>()} onSelectionChange={(k) => { setSubId(Number(Array.from(k)[0]) || null); setValues({}); }}>
                    {cat.subcategories.map((x) => <SelectItem key={String(x.id)}>{x.name}</SelectItem>)}
                </Select>
                {(sub?.fields ?? []).map((f) => f.type === "SELECT"
                    ? <Select key={f.key} className="w-44" size="sm" label={f.label} labelPlacement="outside" selectedKeys={values[f.key] ? new Set([values[f.key]]) : new Set<string>()} onSelectionChange={(k) => setValues((v) => ({ ...v, [f.key]: String(Array.from(k)[0] ?? "") }))}>{f.options.map((o) => <SelectItem key={o}>{o}</SelectItem>)}</Select>
                    : <Input key={f.key} className="w-44" size="sm" label={f.label} labelPlacement="outside" value={values[f.key] ?? ""} onValueChange={(x) => setValues((v) => ({ ...v, [f.key]: x }))} />)}
                <Select className="w-36" size="sm" label="Priority" labelPlacement="outside" selectedKeys={new Set([priority])} onSelectionChange={(k) => setPriority(String(Array.from(k)[0]))}>
                    {PRIORITIES.map((p) => <SelectItem key={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </Select>
                <Input className="w-44" size="sm" label="Requester's department ID" labelPlacement="outside" placeholder="optional" value={dept} onValueChange={setDept} />
                <Button size="sm" color="primary" isLoading={busy} isDisabled={!subId} onPress={run}>Test</Button>
            </div>
            {res && (
                <div className="flex flex-col gap-2 text-sm">
                    <p><b>{res.route.teamName ?? "Triage"}</b> <span className="text-ink-500">· {res.route.via}</span></p>
                    {res.route.trace.map((t, i) => <p key={i} className={cn("text-xs", t.matched ? "text-emerald-600" : "text-ink-500")}>{t.matched ? "✓" : "✗"} {t.rule}{t.note ? ` (${t.note})` : ""}</p>)}
                    {res.pick && <p><b>{res.pick.userId ? res.pick.members.find((m) => m.userId === res.pick!.userId)?.name : "Nobody yet"}</b> <span className="text-ink-700 dark:text-ink-200">· {res.methodLabel}: {res.pick.why}</span></p>}
                    {res.pick && <p className="text-xs text-ink-500">{res.pick.members.map((m) => `${m.name} ${m.open}/${m.limit}${m.away ? " away" : ""}`).join(" · ")}</p>}
                </div>
            )}
        </div>
    );
}
