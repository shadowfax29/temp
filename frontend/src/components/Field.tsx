import type { ReactNode } from "react";

/** One form field with the same spacing everywhere: label, the control, then a hint or the error. The control gets an aria-label instead of its own label. */
export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: ReactNode; error?: string | null; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-600 dark:text-ink-300">{label}{required && <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>}</span>
            {children}
            {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : hint ? <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{hint}</p> : null}
        </div>
    );
}

/** A titled block of fields inside a drawer */
export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-4 border-t border-ink-100 pt-5 first:border-t-0 first:pt-0 dark:border-white/10">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-ink-900 dark:text-white">{title}</h3>
            {children}
        </section>
    );
}
