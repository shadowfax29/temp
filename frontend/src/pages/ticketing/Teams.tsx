import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page";
import { addToast } from "@/components/ui";
import { errorText, ticketingApi, type SettingsTeam } from "@/components/ticketing/api";
import TeamsPanel from "@/components/ticketing/TeamsPanel";

/** Teams: who handles tickets, and how they are given out */
export default function TeamsPage() {
    const [teams, setTeams] = useState<SettingsTeam[]>([]);
    const load = useCallback(() => {
        ticketingApi.teams().then(setTeams).catch((e) => addToast({ title: "Could not load teams", description: errorText(e), color: "danger" }));
    }, []);
    useEffect(load, [load]);
    return (
        <div className="flex flex-col gap-6">
            <PageHeader title="Teams" subtitle="The people who handle tickets. Each team has a lead, its members and a way of giving out tickets." />
            <TeamsPanel teams={teams} reload={load} />
        </div>
    );
}
