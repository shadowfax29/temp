import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";

import { Segmented } from "@/components/page";
import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Input, Select, SelectItem, Textarea, addToast } from "@/components/ui";
import { PRIORITIES, PRIORITY_LABEL, errorText, ticketingApi, type Catalog, type Priority } from "./api";
import { FilePicker } from "./files";

/** Raise a ticket from a side canvas: ticket type, the department that handles it, (if you like) a person of that department, then the details and any files or videos. */
export default function NewTicketDrawer({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (key: string) => void }) {
    const [cat, setCat] = useState<Catalog | null>(null);
    const [email, setEmail] = useState("");
    const [meId, setMeId] = useState(0);
    const [typeId, setTypeId] = useState<number | null>(null);
    const [teamId, setTeamId] = useState<number | null>(null);
    const [assigneeId, setAssigneeId] = useState<number | null>(null);
    const [subject, setSubject] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] = useState<Priority>("MEDIUM");
    const [files, setFiles] = useState<File[]>([]);
    const [saving, setSaving] = useState(false);

    // a fresh form each time it opens
    useEffect(() => {
        if (!isOpen) return;
        setTypeId(null); setTeamId(null); setAssigneeId(null); setSubject(""); setDescription(""); setPriority("MEDIUM"); setFiles([]);
        ticketingApi.catalog().then((c) => { setCat(c); if (!c.chooseDepartment && c.departments.length === 1) setTeamId(c.departments[0]!.id); }).catch((e) => { addToast({ title: "Could not load the form", description: errorText(e), color: "danger" }); setCat({ chooseDepartment: true, types: [], departments: [] }); });
        ticketingApi.me().then((m) => { setEmail(m.email); setMeId(m.userId); }).catch(() => undefined);
    }, [isOpen]);

    const type = useMemo(() => cat?.types.find((x) => x.id === typeId) ?? null, [cat, typeId]);
    const team = useMemo(() => cat?.departments.find((t) => t.id === teamId) ?? null, [cat, teamId]);
    const ready = !!type && !!team && (!cat?.chooseDepartment || !!assigneeId) && subject.trim().length > 2 && description.trim().length > 2;

    const submit = async () => {
        if (!type || !team) return;
        setSaving(true);
        try {
            const { key } = await ticketingApi.create({ subcategoryId: type.id, teamId: team.id, assigneeId: assigneeId ?? undefined, subject, description, priority }, files);
            addToast({ title: `Ticket ${key} raised`, description: "The team has been told. You can follow it under Raised by me.", color: "success" });
            onCreated(key);
        } catch (e) {
            addToast({ title: "Could not raise the ticket", description: errorText(e), color: "danger" });
        } finally { setSaving(false); }
    };

    return (
        <Drawer isOpen={isOpen} onOpenChange={(o) => { if (!o) onClose(); }} size="2xl">
            <DrawerContent>
                <DrawerHeader className="flex flex-col gap-1"><span className="eyebrow">Ticketing</span><span>New ticket</span></DrawerHeader>
                <DrawerBody className="gap-5">
                    <p className="text-sm text-ink-500 dark:text-ink-400">Choose the type of ticket, the department that should handle it and the person in that department. Then tell them what you need.</p>
                    {cat === null ? <p className="text-sm text-ink-500">Loading…</p> : !cat.types.length || !cat.departments.length ? (
                        <p className="text-sm text-ink-500 dark:text-ink-400">Ticketing is not ready yet: an admin adds ticket types, and your department must be added as a team, in Ticketing → Settings.</p>
                    ) : (
                        <div className={cat.chooseDepartment ? "grid gap-5 sm:grid-cols-3" : "grid gap-5 sm:grid-cols-2"}>
                            <Select label="Ticket type" labelPlacement="outside" placeholder="Choose a ticket type" isRequired
                                selectedKeys={typeId ? new Set([String(typeId)]) : new Set<string>()} onSelectionChange={(k) => { setTypeId(Number(Array.from(k)[0]) || null); }}>
                                {cat.types.map((s) => <SelectItem key={String(s.id)}>{s.name}</SelectItem>)}
                            </Select>
                            <Select label="Department" labelPlacement="outside" placeholder="Choose a department" isRequired isDisabled={!cat.chooseDepartment && cat.departments.length === 1}
                                description={!cat.chooseDepartment ? "" : undefined}
                                selectedKeys={teamId ? new Set([String(teamId)]) : new Set<string>()} onSelectionChange={(k) => { setTeamId(Number(Array.from(k)[0]) || null); setAssigneeId(null); }}>
                                {cat.departments.map((t) => <SelectItem key={String(t.id)}>{t.name}</SelectItem>)}
                            </Select>
                            {cat.chooseDepartment && (
                                <Select label="Assignee" labelPlacement="outside" isRequired isDisabled={!team} placeholder={!team ? "Choose a department first" : team.members.length ? "Choose a person" : "This department has no members"}
                                    selectedKeys={assigneeId ? new Set([String(assigneeId)]) : new Set<string>()} onSelectionChange={(k) => setAssigneeId(Number(Array.from(k)[0]) || null)}>
                                    {(team?.members ?? []).map((m) => <SelectItem key={String(m.userId)} textValue={m.name}>{m.userId === meId ? `${m.name} (me)` : m.name}</SelectItem>)}
                                </Select>
                            )}
                        </div>
                    )}
                    {team && type && (
                        <>
                            <Input label="Your email" labelPlacement="outside" value={email} isReadOnly description="Updates on this ticket are sent to this address." />
                            <Input label="Subject" labelPlacement="outside" placeholder="A short title" value={subject} onValueChange={setSubject} maxLength={200} isRequired />
                            <Textarea label="Description" labelPlacement="outside" placeholder="What do you need, and by when?" minRows={5} value={description} onValueChange={setDescription} isRequired />
                            <div className="flex flex-col gap-1.5">
                                <span className="eyebrow">Priority</span>
                                <Segmented size="sm" label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p] }))} />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="eyebrow">Files and videos</span>
                                <FilePicker files={files} onChange={setFiles} />
                            </div>
                        </>
                    )}
                </DrawerBody>
                <DrawerFooter className="justify-between">
                    <p className="text-xs text-ink-500 dark:text-ink-400">Follow it, and reply to the team, from Raised by me on the Tickets page.</p>
                    <div className="flex gap-2">
                        <Button variant="light" onPress={onClose}>Cancel</Button>
                        <Button color="primary" startContent={<Send size={14} />} isDisabled={!ready} isLoading={saving} onPress={submit}>Raise ticket</Button>
                    </div>
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    );
}
