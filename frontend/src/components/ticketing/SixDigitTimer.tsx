import { useEffect, useState } from "react";

const two = (n: number) => (n < 10 ? "0" : "") + n;

/** The consolidated ticket time as total hours + MM + SS digit boxes. Counts up by itself while the timer runs. */
export default function SixDigitTimer({ totalSecs, running, since }: { totalSecs: number; running: boolean; since: string | null }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => setTick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, [running]);
    // the server total already includes the running lap up to when the page was loaded; add what passed since then
    const [loadedAt] = useState(() => Date.now());
    void tick;
    const extra = running ? Math.max(0, Math.floor((Date.now() - loadedAt) / 1000)) : 0;
    const secs = totalSecs + extra;
    const hh = Math.floor(secs / 3600);
    const mm = Math.floor((secs % 3600) / 60);
    const ss = secs % 60;
    const hhStr = String(hh);
    const mmStr = two(mm);
    const ssStr = two(ss);
    const parts = [...hhStr, ...mmStr, ...ssStr];
    // colon positions: after hh digits, and after mm digits
    const colonAfter = [hhStr.length - 1, hhStr.length + 1];
    return (
        <div>
            <div className="flex flex-wrap items-center gap-1.5" role="timer" aria-label={`Time on this ticket ${hh} hours ${mm} minutes ${ss} seconds`}>
                {parts.map((d, i) => (
                    <span key={i} className="contents">
                        <span className="grid h-14 w-11 place-items-center border border-b-[3px] border-ink-200 border-b-brand-600 bg-white text-3xl font-bold tabular-nums dark:border-white/15 dark:border-b-brand-500 dark:bg-ink-900">{d}</span>
                        {colonAfter.includes(i) && <span className="px-0.5 text-2xl font-bold text-ink-400">:</span>}
                    </span>
                ))}
            </div>
            <div className="mt-1 pl-1 text-[11px] uppercase tracking-wider text-ink-500">Hours · Minutes · Seconds</div>
            {running && since && <span className="sr-only">Running since {since}</span>}
        </div>
    );
}
