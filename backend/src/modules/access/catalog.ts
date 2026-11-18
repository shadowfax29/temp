/** Every permission a role can be given, and the actions on each. One source for the role screen and for the checks. */
export const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
export type Privileges = Record<string, Action[]>;

/** `actions`: the ones that mean something for this permission (the role screen shows only these) */
export interface ModuleDef { id: string; label: string; description: string; actions?: Action[]; children?: ModuleDef[] }

export const CATALOG: ModuleDef[] = [
  {
    id: 'ticketing', label: 'Ticketing', description: 'The ticket pages; each one below is its own permission. Which tickets a person sees also depends on their teams', children: [
      { id: 'tkt_new', label: 'New Ticket', description: 'The "New ticket" button: raise a ticket (Create)', actions: ['read', 'create'] },
      { id: 'tkt_my', label: 'Raised by me', description: 'Open the tickets you raised, reply to the team and reopen a resolved one', actions: ['read', 'create', 'update'] },
      { id: 'tkt_inbox', label: 'Tickets', description: 'The ticket lists of your teams; Edit lets you assign, hand off, reply and change status', actions: ['read', 'update'] },
      { id: 'tkt_report', label: 'Ticket Report', description: 'The Report page: totals, averages, breakdowns and CSV', actions: ['read'] },
      { id: 'tkt_teams', label: 'Teams', description: 'Create teams, choose their lead and members and how tickets are given out', actions: ['read', 'update'] },
      { id: 'tkt_categories', label: 'Ticket categories', description: 'Create the categories people choose when they raise a ticket', actions: ['read', 'update'] },
    ],
  },
  {
    id: 'admin', label: 'Administration', description: 'People and what they may do', children: [
      { id: 'adm_roles', label: 'Roles', description: 'Create roles and tick what each may do', actions: ['read', 'create', 'update', 'delete'] },
      { id: 'adm_users', label: 'Users', description: 'Add people, give them a role, switch them off, set two-step sign-in', actions: ['read', 'create', 'update'] },
      { id: 'adm_logs', label: 'Login logs', description: 'Who signed in, failed to sign in or was locked out, and from where', actions: ['read'] },
    ],
  },
];

const flat = (list: ModuleDef[]): string[] => list.flatMap((m) => [m.id, ...(m.children ? flat(m.children) : [])]);
export const MODULE_IDS = flat(CATALOG);
export const FULL_ACCESS: Privileges = Object.fromEntries(MODULE_IDS.map((m) => [m, [...ACTIONS]])) as Privileges;

/** Keeps only known modules and actions; any other action implies View */
export function normalize(input: unknown, implyRead = true): Privileges {
  const out: Privileges = {};
  if (!input || typeof input !== 'object') return out;
  for (const [m, acts] of Object.entries(input as Record<string, unknown>)) {
    if (!MODULE_IDS.includes(m) || !Array.isArray(acts)) continue;
    const set = new Set((acts as unknown[]).filter((a): a is Action => (ACTIONS as readonly string[]).includes(a as string)));
    if (implyRead && set.size) set.add('read');
    if (set.size) out[m] = ACTIONS.filter((a) => set.has(a));
  }
  return out;
}
