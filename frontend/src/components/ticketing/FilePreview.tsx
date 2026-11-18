import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Button, Modal, ModalBody, ModalContent, ModalHeader } from "@/components/ui";
import type { Attachment } from "./api";

type Shown =
    | { t: "loading" }
    | { t: "image" | "video" | "audio" | "pdf"; src: string }
    | { t: "text"; text: string }
    | { t: "html"; html: string }
    | { t: "sheet"; sheets: { name: string; rows: string[][] }[] }
    | { t: "none"; why: string };

const ext = (n: string) => n.split(".").pop()?.toLowerCase() ?? "";

/** Read the file once and decide how to show it: pictures, video, audio and PDFs natively; text, Word and Excel files as readable content. */
async function load(a: Attachment, url: string): Promise<Shown> {
    const e = ext(a.name);
    const res = await fetch(url);
    if (!res.ok) {
        const why = res.status === 404 ? "This file is not on the server yet. The UVdesk attachments folder (public/assets/threads) still has to be copied into the ticketing backend." : "The file could not be loaded.";
        return { t: "none", why };
    }
    const blob = await res.blob();
    const obj = () => URL.createObjectURL(blob);
    if (a.kind === "image") return { t: "image", src: obj() };
    if (a.kind === "video") return { t: "video", src: obj() };
    if (a.kind === "audio") return { t: "audio", src: obj() };
    if (e === "pdf") return { t: "pdf", src: obj() };
    if (["txt", "csv", "log"].includes(e)) return { t: "text", text: (await blob.text()).slice(0, 500000) };
    if (e === "docx") {
        const mammoth = await import("mammoth");
        const out = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        return { t: "html", html: out.value };
    }
    if (e === "xlsx") {
        const { default: readXlsx, InvalidInputError } = await import("read-excel-file/browser");
        let all;
        try {
            all = await readXlsx(blob);
        } catch (err) {
            if (err instanceof InvalidInputError && err.code === "XLS_FILE_NOT_SUPPORTED") {
                return { t: "none", why: "This is a legacy .xls file and cannot be previewed. Download it to open it in Excel or Google Sheets." };
            }
            throw err;
        }
        const sheets = all.slice(0, 10).map((s) => ({
            name: s.sheet,
            rows: s.data.slice(0, 500).map((r) => r.map((c) => (c == null ? "" : c instanceof Date ? c.toLocaleString() : String(c)))),
        }));
        return { t: "sheet", sheets };
    }
    return { t: "none", why: "This kind of file cannot be shown here (older Word, Excel and PowerPoint files, and archives). Download it to open it." };
}

/** A pop-up that shows the attachment without leaving the ticket */
export function FilePreview({ file, url, onClose }: { file: Attachment | null; url: string | null; onClose: () => void }) {
    const [shown, setShown] = useState<Shown>({ t: "loading" });
    const [sheet, setSheet] = useState(0);

    useEffect(() => {
        if (!file || !url) return;
        let dead = false;
        let made: string | null = null;
        setShown({ t: "loading" }); setSheet(0);
        load(file, url)
            .then((s) => { if (dead) return; if ("src" in s) made = s.src; setShown(s); })
            .catch(() => { if (!dead) setShown({ t: "none", why: "This file could not be opened. Download it instead." }); });
        return () => { dead = true; if (made) URL.revokeObjectURL(made); };
    }, [file, url]);

    return (
        <Modal isOpen={!!file} onClose={onClose} size="5xl" scrollBehavior="inside">
            <ModalContent>
                <ModalHeader className="flex items-center gap-3 pr-10">
                    <span className="min-w-0 flex-1 truncate">{file?.name}</span>
                    {url && <a href={url} download={file?.name}><Button size="sm" variant="flat" startContent={<Download size={14} />}>Download</Button></a>}
                </ModalHeader>
                <ModalBody className="pb-6">
                    {shown.t === "loading" && <p className="py-16 text-center text-sm text-ink-500">Loading…</p>}
                    {shown.t === "image" && <img src={shown.src} alt={file?.name} className="mx-auto max-h-[75vh] max-w-full object-contain" />}
                    {shown.t === "video" && <video src={shown.src} controls autoPlay className="mx-auto max-h-[75vh] max-w-full" />}
                    {shown.t === "audio" && <audio src={shown.src} controls className="mx-auto w-full max-w-xl" />}
                    {shown.t === "pdf" && <iframe src={shown.src} title={file?.name} className="h-[75vh] w-full border-0" />}
                    {shown.t === "text" && <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap text-sm">{shown.text}</pre>}
                    {shown.t === "html" && <div className="max-h-[75vh] max-w-none overflow-auto text-sm [&_table]:border-collapse [&_td]:border [&_td]:px-2" dangerouslySetInnerHTML={{ __html: shown.html }} />}
                    {shown.t === "sheet" && (
                        <div className="flex flex-col gap-3">
                            {shown.sheets.length > 1 && (
                                <div className="flex flex-wrap gap-2">
                                    {shown.sheets.map((s, i) => (
                                        <button key={s.name} type="button" onClick={() => setSheet(i)} className={`border px-3 py-1 text-xs font-semibold ${i === sheet ? "border-brand-600 bg-brand-50 text-brand-600" : "border-ink-200"}`}>{s.name}</button>
                                    ))}
                                </div>
                            )}
                            <div className="max-h-[70vh] overflow-auto border border-ink-200 dark:border-white/10">
                                <table className="min-w-full border-collapse text-xs">
                                    <tbody>
                                        {shown.sheets[sheet]?.rows.map((r, i) => (
                                            <tr key={i} className={i === 0 ? "bg-ink-50 font-semibold dark:bg-white/5" : ""}>
                                                {r.map((c, j) => <td key={j} className="whitespace-nowrap border border-ink-100 px-2 py-1 dark:border-white/10">{c}</td>)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {shown.t === "none" && <p className="py-12 text-center text-sm text-ink-500">{shown.why}</p>}
                </ModalBody>
            </ModalContent>
        </Modal>
    );
}
