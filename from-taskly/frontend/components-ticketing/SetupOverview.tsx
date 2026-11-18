import { Link } from "react-router-dom";
import { ArrowRight, Check, CircleAlert } from "lucide-react";
import { cn } from "@heroui/theme";

import { Panel } from "@/components/page";
import { Button } from "@/components/ui";
import type { SettingsCategory, SettingsTeam } from "./api";

type Tab = "overview" | "teams" | "types";
type State = "done" | "todo" | "attention" | "optional";

const CHIP: Record<State, { label: string; cls: string }> = {
    done: { label: "Done", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
    todo: { label: "To do", cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" },
    attention: { label: "Needs attention", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
    optional: { label: "Optional", cls: "bg-ink-100 text-ink-600 dark:bg-white/10 dark:text-ink-300" },
};

/** What is ready and what is missing, in the order an admin should do it */
export default function SetupOverview({ teams, cats, go }: { teams: SettingsTeam[]; cats: SettingsCategory[]; go: (t: Tab) => void }) {
    const liveTeams = teams.filter((t) => t.active);
    const typeCount = cats.reduce((n, c) => n + c.subcategories.filter((x) => x.active).length, 0);

    const teamIssues = liveTeams.flatMap((t) => [
        ...(t.leadUserId ? [] : [`${t.name} has no team lead`]),
        ...(t.members.some((m) => m.active) ? [] : [`${t.name} has no members`]),
    ]);
    const groupIssues: string[] = [];

    const teamState: State = !liveTeams.length ? "todo" : teamIssues.length ? "attention" : "done";
    const groupState: State = !typeCount ? "todo" : "done";
    const ready = teamState === "done" && groupState === "done";

    const steps: { n: number; title: string; state: State; text: string; action?: { label: string; onPress: () => void } }[] = [
        {
            n: 1, title: "Teams: who handles tickets", state: teamState,
            text: liveTeams.length ? `${liveTeams.length} team${liveTeams.length > 1 ? "s" : ""}, built from your departments and sub departments. Their people and leaders are kept in step automatically.` : "Pick the sub departments that will handle tickets. Their people become the team and their leader the team lead.",
            action: { label: liveTeams.length ? "Manage teams" : "Add a team", onPress: () => go("teams") },
        },
        {
            n: 2, title: "Ticket types: what people can ask for", state: groupState,
            text: typeCount ? `${typeCount} ticket type${typeCount > 1 ? "s" : ""}. People choose one when they raise a ticket.` : "A ticket type is a kind of request (for example VPN access). Add the ones people can raise, with any extra questions to answer.",
            action: { label: typeCount ? "Manage ticket types" : "Add a ticket type", onPress: () => go("types") },
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <Panel title="How a ticket travels">
                <ol className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                    {[
                        ["Customer raises it", "Picks a ticket type, a department and, if they like, a person of it"],
                        ["A team gets it", "The department the customer chose"],
                        ["An agent gets it", "The person chosen, else by the department's method, else its lead assigns"],
                        ["Answered ⇄ Open", "A reply from the team makes it Answered; the customer's reply opens it again"],
                        ["Resolved, then Closed", "The agent resolves it with a note; a team lead closes it"],
                    ].map(([t, d], i) => (
                        <li key={t} className="border border-ink-200 p-3 dark:border-white/10">
                            <p className="text-xs font-bold text-brand-600">{i + 1}</p>
                            <p className="font-semibold text-ink-900 dark:text-white">{t}</p>
                            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{d}</p>
                        </li>
                    ))}
                </ol>
            </Panel>

            <div className="flex flex-col gap-3">
                {steps.map((s) => (
                    <div key={s.n} className="flex flex-wrap items-center gap-4 border border-ink-200 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center text-sm font-bold", s.state === "done" ? "bg-emerald-600 text-white" : "bg-ink-100 text-ink-700 dark:bg-white/10 dark:text-ink-200")}>
                            {s.state === "done" ? <Check size={16} /> : s.n}
                        </span>
                        <div className="min-w-[260px] flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900 dark:text-white">{s.title}<span className={cn("px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", CHIP[s.state].cls)}>{CHIP[s.state].label}</span></p>
                            <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{s.text}</p>
                        </div>
                        {s.action && <Button size="sm" variant={s.state === "done" || s.state === "optional" ? "bordered" : "solid"} color={s.state === "done" || s.state === "optional" ? "default" : "primary"} endContent={<ArrowRight size={13} />} onPress={s.action.onPress}>{s.action.label}</Button>}
                    </div>
                ))}
                <div className="flex flex-wrap items-center gap-4 border border-ink-200 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center text-sm font-bold", ready ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 dark:bg-white/10 dark:text-ink-200")}>3</span>
                    <div className="min-w-[260px] flex-1">
                        <p className="font-semibold text-ink-900 dark:text-white">Try it</p>
                        <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{ready ? "Raise a test ticket: choose a ticket type, a department and, if you like, a person." : "Finish steps 1 and 2 first, then raise a test ticket."}</p>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/ticketing/inbox?new=1"><Button size="sm" color="primary" isDisabled={!ready}>Raise a test ticket</Button></Link>
                    </div>
                </div>
            </div>

            {(teamIssues.length > 0 || groupIssues.length > 0) && (
                <Panel title="Things to fix">
                    <ul className="flex flex-col gap-2 text-sm">
                        {[...teamIssues.map((t) => ({ t, tab: "teams" as Tab })), ...groupIssues.map((t) => ({ t, tab: "types" as Tab }))].map((i, k) => (
                            <li key={k} className="flex items-start justify-between gap-3">
                                <span className="flex items-start gap-2 text-ink-700 dark:text-ink-200"><CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" />{i.t}</span>
                                <Button size="sm" variant="light" onPress={() => go(i.tab)}>Fix</Button>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
        </div>
    );
}
