import axios from "axios";

// Ticketing API (phase 1). Responses are { success, response }.

const BASE = "/api/ticketing";

export type Status = "OPEN" | "PENDING" | "ANSWERED" | "RESOLVED" | "CLOSED" | "SPAM";
export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type Privilege = "ASSOCIATE" | "LEAD" | "ADMIN";
export type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "SELECT" | "DATE";
export type Method = "MANUAL" | "ROUND_ROBIN" | "LEAST_OPEN" | "SKILL" | "SELF_PICK";
export const METHODS: { key: Method; label: string; hint: string }[] = [
    { key: "MANUAL", label: "Manual", hint: "Lands in the team list; the team lead assigns" },
    { key: "ROUND_ROBIN", label: "Round-robin", hint: "The next available member after the last one assigned" },
    { key: "LEAST_OPEN", label: "Least open tickets", hint: "The available member with the fewest open tickets" },
    { key: "SKILL", label: "Skill match", hint: "Members with the category's skill, then the least open" },
    { key: "SELF_PICK", label: "Self-pick", hint: "Members take tickets from the team list" },
];
export type CondType = "subcategory" | "field" | "department" | "priority";
export interface Cond { type: CondType; key?: string; op: "is" | "is_not"; value: string }
export interface RuleDraft { name: string; conditions: Cond[]; teamId: number; active: boolean }

export const STATUS_LABEL: Record<Status, string> = {
    OPEN: "Open", PENDING: "Pending", ANSWERED: "Answered", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
export const PRIORITIES: Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const PRIVILEGE_LABEL: Record<Privilege, string> = { ASSOCIATE: "Associate", LEAD: "Lead", ADMIN: "Admin" };

export interface Me {
    userId: number; name: string; email: string; isAdmin: boolean; isAgent: boolean;
    teams: { id: number; name: string; privilege: Privilege; isLead: boolean }[];
    away: boolean;
    ownedCategories: { id: number; name: string; prefix: string }[];
}

export interface FieldDef { key: string; label: string; type: FieldType; required: boolean; options: string[] }
/** What the New ticket form offers: the categories, and the teams with their people */
export interface Catalog {
    chooseDepartment: boolean;
    /** only people who work tickets can name the assignee; for everyone else the team decides */
    chooseAssignee: boolean;
    types: { id: number; categoryId: number; name: string; fields: FieldDef[] }[];
    departments: { id: number; name: string; members: { userId: number; name: string }[] }[];
}

export interface Lap { n: number; ownerId: number; owner: string; team: string | null; startedBy: string; endedBy: string | null; start: string; end: string | null; secs: number; running: boolean }
export interface Timer { totalSecs: number; running: boolean; since: string | null; laps: Lap[]; paused: boolean; note: string }

export interface TicketRow {
    key: string; subject: string; status: Status; priority: Priority; category: string; subcategory: string;
    team: string | null; requester: string | null; requesterEmail: string | null; assignee: string | null; assigneeId: number | null; createdAt: string; updatedAt: string;
}
export interface TicketList { tickets: TicketRow[]; total: number; page: number; size: number; counts?: Record<string, number> }
export type InboxView = "all" | "new" | "unassigned" | "unanswered" | "assigned" | "triage" | "pending" | "answered" | "resolved" | "closed" | "spam";

export interface Attachment { id: number; name: string; size: number; kind: "image" | "video" | "audio" | "file" }
export interface Message { id: number; kind: "REPLY" | "NOTE" | "SYSTEM"; body: string; at: string; authorId: number | null; author: string; attachments: Attachment[] }
export interface Transition { to: Status; needs?: "comment" | "resolution" }
export interface TicketDetail {
    key: string; subject: string; description: string; status: Status; priority: Priority;
    category: { id: number; name: string }; subcategory: { id: number; name: string };
    team: { id: number; name: string; leadUserId: number | null } | null;
    requester: { id: number; name: string; email: string; department: string | null; manager: string | null };
    assignee: { id: number; name: string } | null;
    fields: (FieldDef & { value: unknown })[];
    messages: Message[];
    createdAt: string; updatedAt: string; firstResponseAt: string | null; resolvedAt: string | null; closedAt: string | null; resolutionNote: string | null;
    permissions: {
        isRequester: boolean; isAgent: boolean; canReply: boolean; canNote: boolean; canReopen: boolean; canSetPriority: boolean;
        canTake: boolean; canAssign: boolean; canHandOver: boolean; canRoute: boolean; canTransfer: boolean; canRecategorize: boolean; transitions: Transition[];
    };
    teamMembers: { userId: number; name: string; privilege: Privilege; open: number; limit: number }[];
    routeTeams: { id: number; name: string }[];
    transferTeams: { id: number; name: string }[];
    watchers: { userId: number; name: string }[];
    timer: Timer;
}

export interface HistoryEvent {
    id: number; type: string; kind: "USER" | "SYSTEM" | "RULE" | "EMAIL"; actor: string; impersonatedBy: string | null;
    old: unknown; next: unknown; details: string | null; team: string | null; user: string | null; at: string;
}
export interface HistoryPeriod { id: number; team: string | null; assignee: string | null; status: Status; from: string; to: string | null; endedBecause: string | null }
export interface History { imported?: boolean; chain: { ok: boolean; events: number; brokenAt: number | null }; events: HistoryEvent[]; periods: HistoryPeriod[] }

export interface NewTicket { subcategoryId: number; subject: string; description: string; priority: Priority; teamId?: number; assigneeId?: number; fields?: Record<string, string> }
export const MAX_FILES = 5;
export const MAX_FILE_MB = 100;
const asForm = (o: Record<string, unknown>, files: File[]) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    files.forEach((x) => f.append("files", x));
    return f;
};

// settings
export interface SettingsCategory {
    id: number; name: string; prefix: string; description: string | null; active: boolean; departmentId: number | null; departmentName: string | null;
    ownerUserId: number | null; ownerName: string | null; defaultTeamId: number | null; ticketCount: number; teams: { id: number; name: string }[];
    subcategories: { id: number; name: string; active: boolean; sortOrder: number; defaultTeamId: number | null; skill: string | null; counts: { total: number; open: number; resolved: number; pending: number }; fields: FieldDef[] }[];
    rules: { id: number; name: string; teamId: number; teamName: string; active: boolean; conditions: Cond[] }[];
}
export interface CategoryDraft { name: string; prefix: string; description: string; ownerUserId: number | null; defaultTeamId: number | null; active: boolean; teamIds: number[] }
export interface SettingsTeam {
    id: number; name: string; leadUserId: number | null; leadName: string | null; assignmentMethod: string; maxOpen: number; active: boolean; openTickets: number;
    categories: { id: number; name: string }[];
    /** the sub department behind the team (null = a custom team) */
    departmentId: number | null; departmentName: string | null; primaryDepartmentName: string | null; leadLocked: boolean;
    members: { userId: number; name: string; email: string; privilege: Privilege; active: boolean; open: number; away: boolean; skills: string[]; source: "DEPT" | "MANUAL"; excluded: boolean }[];
}
export interface TeamDraft { name: string; leadUserId?: number | null; maxOpen: number; active: boolean; categoryIds: number[]; assignmentMethod: Method; useDepartmentLead?: boolean }
/** Department Management as a picker: departments, each with its sub departments */
export interface DepartmentTree {
    id: number; name: string; code: string | null; type: string | null;
    subDepartments: { id: number; name: string; code: string | null; isWhole: boolean; people: number; leadName: string | null; teamId: number | null; relation: "EL" | "FL" | "MANAGER" | null; reportCount: number }[];
}
export interface RouteTest {
    route: { teamId: number | null; teamName: string | null; via: string; ruleId: number | null; trace: { rule: string; matched: boolean; note?: string }[] };
    pick: { userId: number | null; why: string; skipped: { name: string; reason: string }[]; members: { userId: number; name: string; open: number; limit: number; away: boolean; skills: string[] }[] } | null;
    methodLabel: string | null;
}
export interface PickUser { id: number; name: string; email: string; department: string | null }

export interface ReportRow { name: string; total: number; open?: number | null; done?: number | null; firstResponseMin?: number | null }
export interface ReportFilters { from?: string; to?: string; teamId?: number; status?: string; priority?: string; typeId?: number; assigneeId?: number; unassigned?: string; q?: string }
export interface TicketReport {
    from: string; to: string; teamId: number | null; teams: { id: number; name: string }[]; types: { id: number; name: string }[]; agents: { id: number; name: string }[];
    totals: { raised: number; open: number; resolved: number; closed: number; spam: number; unassigned: number; triage: number; resolvedPercent: number; avgFirstResponseMin: number | null; avgResolutionHours: number | null };
    byStatus: ReportRow[]; byPriority: ReportRow[]; byTeam: ReportRow[]; byType: ReportRow[]; byAgent: ReportRow[]; byRequester: ReportRow[];
    perDay: { day: string; total: number }[];
    oldestOpen: { key: string; subject: string; status: Status; priority: Priority; team: string | null; assignee: string | null; ageHours: number }[];
}

const unwrap = <T,>(p: Promise<{ data: { response: T } }>) => p.then((r) => r.data.response);
export const errorText = (e: any) => e?.response?.data?.message || e?.message || "Something went wrong.";

export const ticketingApi = {
    report: (params: ReportFilters) => unwrap<TicketReport>(axios.get(`${BASE}/report`, { params })),
    me: () => unwrap<Me>(axios.get(`${BASE}/me`)),
    catalog: () => unwrap<Catalog>(axios.get(`${BASE}/catalog`)),
    create: (t: NewTicket, files: File[] = []) => unwrap<{ key: string }>(axios.post(`${BASE}/tickets`, asForm({ ...t }, files))),
    mine: (params: Record<string, unknown>) => unwrap<TicketList>(axios.get(`${BASE}/tickets/mine`, { params })),
    inbox: (params: Record<string, unknown>) => unwrap<TicketList>(axios.get(`${BASE}/tickets/inbox`, { params })),
    get: (key: string) => unwrap<TicketDetail>(axios.get(`${BASE}/tickets/${key}`)),
    history: (key: string) => unwrap<History>(axios.get(`${BASE}/tickets/${key}/history`)),
    reply: (key: string, body: string, files: File[] = []) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/reply`, asForm({ body }, files))),
    note: (key: string, body: string, files: File[] = []) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/note`, asForm({ body }, files))),
    fileLink: (key: string, id: number) => unwrap<{ url: string; name: string; kind: Attachment["kind"]; size: number }>(axios.get(`${BASE}/tickets/${key}/attachments/${id}/link`)),
    status: (key: string, status: Status, text?: string) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/status`, { status, text })),
    priority: (key: string, priority: Priority) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/priority`, { priority })),
    assign: (key: string, userId: number | null) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/assign`, { userId })),
    take: (key: string) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/take`)),
    route: (key: string, teamId: number) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/route`, { teamId })),
    transfer: (key: string, teamId: number, reason: string) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/transfer`, { teamId, reason })),
    recategorize: (key: string, body: { categoryId: number; subcategoryId: number; fields?: Record<string, string>; reason: string }) =>
        unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/recategorize`, body)),
    reopen: (key: string, reason?: string) => unwrap<TicketDetail>(axios.post(`${BASE}/tickets/${key}/reopen`, { reason })),

    deleteTeam: (id: number) => unwrap<{ deleted: boolean }>(axios.delete(`${BASE}/settings/teams/${id}`)),
    deleteSub: (id: number) => unwrap<{ deleted: boolean }>(axios.delete(`${BASE}/settings/subcategories/${id}`)),
    categories: () => unwrap<SettingsCategory[]>(axios.get(`${BASE}/settings/categories`)),
    saveCategory: (d: CategoryDraft, id?: number) => (id ? axios.put(`${BASE}/settings/categories/${id}`, d) : axios.post(`${BASE}/settings/categories`, d)),
    saveSub: (categoryId: number, d: { name: string; active: boolean; defaultTeamId?: number | null; skill?: string | null }, id?: number) =>
        id ? axios.put(`${BASE}/settings/categories/${categoryId}/subcategories/${id}`, d) : axios.post(`${BASE}/settings/categories/${categoryId}/subcategories`, d),
    setFields: (subId: number, fields: FieldDef[]) => axios.put(`${BASE}/settings/subcategories/${subId}/fields`, { fields }),
    teams: () => unwrap<SettingsTeam[]>(axios.get(`${BASE}/settings/teams`)),
    departments: () => unwrap<DepartmentTree[]>(axios.get(`${BASE}/settings/departments`)),
    teamFromDepartment: (departmentId: number, name?: string) => unwrap<{ id: number; name: string; added: number }>(axios.post(`${BASE}/settings/teams/from-department`, { departmentId, name })),
    syncTeam: (teamId: number) => unwrap<{ added: number; removed: number; leadUserId: number | null }>(axios.post(`${BASE}/settings/teams/${teamId}/sync`)),
    saveTeam: (d: TeamDraft, id?: number) => (id ? axios.put(`${BASE}/settings/teams/${id}`, d) : axios.post(`${BASE}/settings/teams`, d)),
    setRules: (categoryId: number, rules: RuleDraft[]) => axios.put(`${BASE}/settings/categories/${categoryId}/rules`, { rules }),
    routeTest: (categoryId: number, body: { subcategoryId: number; fields: Record<string, string>; departmentIds?: number[]; priority?: string }) =>
        unwrap<RouteTest>(axios.post(`${BASE}/settings/categories/${categoryId}/route-test`, body)),
    setMembers: (teamId: number, members: { userId: number; privilege: Privilege; active?: boolean; skills?: string[] }[]) => axios.put(`${BASE}/settings/teams/${teamId}/members`, { members }),
    users: (q: string) => unwrap<PickUser[]>(axios.get(`${BASE}/settings/users`, { params: { q } })),
};
