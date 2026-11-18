import { useRef, useState } from "react";
import { FileText, Film, Image as ImageIcon, Music, Paperclip, X } from "lucide-react";

import { Button, addToast } from "@/components/ui";
import { MAX_FILES, MAX_FILE_MB, errorText, ticketingApi, type Attachment } from "./api";

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICON = { image: ImageIcon, video: Film, audio: Music, file: FileText } as const;
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.bmp,.mp4,.mov,.webm,.mkv,.avi,.m4v,.mp3,.wav,.m4a,.ogg,.pdf,.txt,.csv,.log,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.zip";

/** Choose files or videos to attach (up to 5, 100 MB each). The parent keeps the list. */
export function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
    const input = useRef<HTMLInputElement>(null);
    const add = (list: FileList | null) => {
        if (!list) return;
        const next = [...files];
        for (const f of Array.from(list)) {
            if (next.length >= MAX_FILES) { addToast({ title: `At most ${MAX_FILES} files`, color: "warning" }); break; }
            if (f.size > MAX_FILE_MB * 1048576) { addToast({ title: `${f.name} is larger than ${MAX_FILE_MB} MB`, color: "warning" }); continue; }
            next.push(f);
        }
        onChange(next);
        if (input.current) input.current.value = "";
    };
    return (
        <div className="flex flex-col gap-2">
            <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => add(e.target.files)} />
            <div className="flex items-center gap-3">
                <Button size="sm" variant="flat" startContent={<Paperclip size={14} />} onPress={() => input.current?.click()} isDisabled={files.length >= MAX_FILES}>Attach files or video</Button>
                <span className="text-xs text-ink-500 dark:text-ink-400">Up to {MAX_FILES} files, {MAX_FILE_MB} MB each</span>
            </div>
            {files.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {files.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                            <Paperclip size={12} className="text-ink-400" />
                            <span className="truncate">{f.name}</span>
                            <span className="text-xs text-ink-500">{size(f.size)}</span>
                            <button type="button" aria-label={`Remove ${f.name}`} className="ml-auto text-ink-400 hover:text-danger" onClick={() => onChange(files.filter((_, j) => j !== i))}><X size={14} /></button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** The files on one message. Pictures, videos and audio show in place; other files open in a new tab. */
export function Attachments({ ticketKey, items }: { ticketKey: string; items: Attachment[] }) {
    const [urls, setUrls] = useState<Record<number, string>>({});
    if (!items?.length) return null;

    const link = async (a: Attachment) => {
        try { const l = await ticketingApi.fileLink(ticketKey, a.id); setUrls((u) => ({ ...u, [a.id]: l.url })); return l.url; }
        catch (e) { addToast({ title: "Could not open the file", description: errorText(e), color: "danger" }); return null; }
    };
    const open = async (a: Attachment) => { const u = urls[a.id] ?? await link(a); if (u) window.open(u, "_blank", "noopener"); };

    return (
        <div className="mt-2 flex flex-col gap-2">
            {items.map((a) => {
                const Icon = ICON[a.kind];
                const u = urls[a.id];
                return (
                    <div key={a.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-sm">
                            <Icon size={14} className="text-ink-400" />
                            <button type="button" className="truncate text-primary hover:underline" onClick={() => (a.kind === "file" ? open(a) : u ? setUrls(({ [a.id]: _x, ...rest }) => rest) : link(a))}>{a.name}</button>
                            <span className="text-xs text-ink-500">{size(a.size)}</span>
                            {a.kind !== "file" && <button type="button" className="text-xs text-ink-500 hover:underline" onClick={() => open(a)}>Open</button>}
                        </div>
                        {u && a.kind === "image" && <img src={u} alt={a.name} className="max-h-72 max-w-full rounded-md border border-ink-200 object-contain dark:border-ink-700" />}
                        {u && a.kind === "video" && <video src={u} controls className="max-h-80 max-w-full rounded-md border border-ink-200 dark:border-ink-700" />}
                        {u && a.kind === "audio" && <audio src={u} controls />}
                    </div>
                );
            })}
        </div>
    );
}
