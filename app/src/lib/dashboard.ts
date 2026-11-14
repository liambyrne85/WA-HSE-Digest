// Dashboard tile calculations (tiles 1–4). Pure functions over rows the user is already
// allowed to see — the database (RLS) decides visibility; this only counts and groups.
import { addDays, perthToday } from './labels';
import type { Investigation, LeadershipTarget, Profile, Project, ProjectMember, RecordRow, Vehicle } from './types';

export interface DashFilters {
  /** '' = all projects the user can see */
  projectId: string;
  /** '' = all leaders */
  leaderId: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
}

export interface DashData {
  records: RecordRow[];
  vehicles: Vehicle[];
  investigations: Investigation[];
  targets: LeadershipTarget[];
  profiles: Profile[];
  projects: Project[];
  members: ProjectMember[];
}

export const INCIDENT_CATEGORIES = ['injury', 'near_miss', 'property_damage', 'vehicle_plant', 'environmental'] as const;
export const LEADER_ROLES = ['admin', 'hset', 'project_manager', 'supervisor'];

/** Days from..to inclusive. */
export function daysIn(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const isWeekday = (ymd: string) => { const g = new Date(`${ymd}T00:00:00Z`).getUTCDay(); return g >= 1 && g <= 5; };

/** Projects a person is currently assigned to (assignment not ended before today). */
export function currentProjectsOf(members: ProjectMember[], profileId: string, today = perthToday()) {
  return members.filter((m) => m.profile_id === profileId && m.start_date <= today && (!m.end_date || m.end_date >= today)).map((m) => m.project_id);
}

/** The project scope for the filters: one project, a leader's projects, or null = everything visible. */
export function projectScope(f: DashFilters, d: DashData): Set<string> | null {
  let scope: Set<string> | null = f.projectId ? new Set([f.projectId]) : null;
  if (f.leaderId) {
    const lp = new Set(currentProjectsOf(d.members, f.leaderId));
    scope = scope ? new Set([...scope].filter((p) => lp.has(p))) : lp;
  }
  return scope;
}
const inScope = (scope: Set<string> | null, projectId: string | null) => !scope || (!!projectId && scope.has(projectId));
const submitted = (r: RecordRow) => r.status !== 'draft' && !r.archived_at;
const inRange = (f: DashFilters, ymd: string | null | undefined) => !!ymd && ymd >= f.from && ymd <= f.to;

// ---- Tile 1: vehicle pre-starts ---------------------------------------------
export interface MissedPrestart { vehicle: Vehicle; date: string }
export function tilePrestarts(f: DashFilters, d: DashData, today = perthToday()) {
  const scope = projectScope(f, d);
  const vehicles = d.vehicles.filter((v) => !v.archived_at && v.is_active && inScope(scope, v.project_id));
  const prestarts = d.records.filter((r) => r.module === 'plant_prestart' && submitted(r) && inScope(scope, r.project_id));
  const done = new Set(prestarts.filter((r) => r.vehicle_id).map((r) => `${r.vehicle_id}|${r.record_date}`));
  // Missed = a required, in-service vehicle with no pre-start on a weekday (Mon–Fri) up to today.
  // A pre-start done on a weekend still counts; weekends are never flagged as missed.
  const days = daysIn(f.from, f.to < today ? f.to : today).filter(isWeekday);
  const missed: MissedPrestart[] = [];
  for (const v of vehicles.filter((x) => x.daily_prestart_required && x.status === 'in_service')) {
    const added = v.created_at.slice(0, 10);
    for (const day of days) if (day >= added && !done.has(`${v.id}|${day}`)) missed.push({ vehicle: v, date: day });
  }
  missed.sort((a, b) => b.date.localeCompare(a.date) || a.vehicle.fleet_number.localeCompare(b.vehicle.fleet_number));
  const failed = prestarts.filter((r) => inRange(f, r.record_date) && Number(r.summary?.failed_items) > 0)
    .sort((a, b) => (b.record_date ?? '').localeCompare(a.record_date ?? ''));
  const outOfService = vehicles.filter((v) => v.status === 'out_of_service');
  const doneInRange = prestarts.filter((r) => inRange(f, r.record_date)).length;
  return { missed, failed, outOfService, vehicles, doneInRange };
}

// ---- Tile 2: open investigations ----------------------------------------------
export function tileInvestigations(f: DashFilters, d: DashData, today = perthToday()) {
  const scope = f.projectId ? new Set([f.projectId]) : null;
  const leaderProjects = f.leaderId ? new Set(currentProjectsOf(d.members, f.leaderId)) : null;
  const open = d.investigations.filter((i) => i.status !== 'closed' && inScope(scope, i.project_id)
    && (!leaderProjects || i.lead_id === f.leaderId || (!!i.project_id && leaderProjects.has(i.project_id))))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const overdue = open.filter((i) => !!i.due_date && i.due_date < today);
  return { open, overdue };
}

// ---- Tile 3: incidents in the period -------------------------------------------
export function tileIncidents(f: DashFilters, d: DashData) {
  const scope = projectScope(f, d);
  const incidents = d.records.filter((r) => r.module === 'safety_event' && submitted(r) && inRange(f, r.record_date) && inScope(scope, r.project_id)
    && (INCIDENT_CATEGORIES as readonly string[]).includes(String(r.summary?.incident_category ?? '')))
    .sort((a, b) => (b.record_date ?? '').localeCompare(a.record_date ?? ''));
  const byType = INCIDENT_CATEGORIES.map((k) => ({ key: k, count: incidents.filter((r) => r.summary?.incident_category === k).length }));
  const projectIds = [...new Set(incidents.map((r) => r.project_id ?? ''))];
  const byProject = projectIds.map((pid) => ({
    projectId: pid, name: d.projects.find((p) => p.id === pid)?.name ?? 'No project',
    count: incidents.filter((r) => (r.project_id ?? '') === pid).length,
  })).sort((a, b) => b.count - a.count);
  return { incidents, byType, byProject };
}

// ---- Tile 4: field leadership vs target -----------------------------------------
export type Rag = 'green' | 'amber' | 'red' | 'none';
export interface LeadershipRow {
  profile: Profile;
  projects: string[];
  completed: number;
  target: number | null;
  pct: number | null;
  rag: Rag;
  records: RecordRow[];
}
/** Scale a weekly / monthly target to the filter period (pro rata by days; a month counts as 30.44 days). */
export function targetFor(t: LeadershipTarget | undefined, from: string, to: string) {
  if (!t || !t.target) return null;
  const days = daysIn(from, to).length;
  const raw = t.period === 'week' ? (t.target * days) / 7 : (t.target * days) / 30.44;
  return Math.round(raw * 10) / 10;
}
export function ragFor(pct: number | null): Rag {
  if (pct === null) return 'none';
  return pct >= 100 ? 'green' : pct >= 80 ? 'amber' : 'red';
}
export function tileLeadership(f: DashFilters, d: DashData) {
  const scope = f.projectId ? new Set([f.projectId]) : null;
  const done = d.records.filter((r) => r.module === 'field_leadership' && submitted(r) && inRange(f, r.record_date) && inScope(scope, r.project_id));
  const candidates = d.profiles.filter((p) => p.is_active && LEADER_ROLES.includes(p.role) && (!f.leaderId || p.id === f.leaderId));
  const rows: LeadershipRow[] = [];
  for (const p of candidates) {
    const mine = done.filter((r) => r.submitted_by === p.id);
    const tgt = d.targets.find((t) => t.profile_id === p.id);
    const assigned = currentProjectsOf(d.members, p.id);
    // Only leaders who have a target or did some field leadership, on the selected project if any.
    if (!mine.length && !tgt?.target) continue;
    if (scope && !mine.length && !assigned.some((x) => scope.has(x))) continue;
    const target = targetFor(tgt, f.from, f.to);
    const pct = target ? Math.round((mine.length / target) * 100) : null;
    const projIds = [...new Set([...mine.map((r) => r.project_id ?? ''), ...(mine.length ? [] : assigned)].filter(Boolean))];
    rows.push({
      profile: p, projects: projIds.map((id) => d.projects.find((x) => x.id === id)?.code || d.projects.find((x) => x.id === id)?.name || '').filter(Boolean),
      completed: mine.length, target, pct, rag: ragFor(pct), records: mine,
    });
  }
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2, none: 3 };
  rows.sort((a, b) => order[a.rag] - order[b.rag] || (a.pct ?? 0) - (b.pct ?? 0) || a.profile.full_name.localeCompare(b.profile.full_name));
  const completed = rows.reduce((n, r) => n + r.completed, 0);
  const target = Math.round(rows.reduce((n, r) => n + (r.target ?? 0), 0) * 10) / 10;
  return { rows, completed, target, pct: target ? Math.round((completed / target) * 100) : null };
}

/** Default range: this week, Monday–Sunday (Perth). */
export function thisWeek(today = perthToday()) {
  const g = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = addDays(today, g === 0 ? -6 : 1 - g);
  return { from, to: addDays(from, 6) };
}
