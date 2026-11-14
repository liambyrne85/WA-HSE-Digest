// Scaffold rules shared by the screens and the demo backend. They mirror
// supabase/migrations/*_scaffolds.sql — the database is what actually enforces them.
import { addDays, perthToday } from './labels';
import type {
  ChecklistSection, InspectionOutcome, LicenceClass, Scaffold, ScaffoldChecklist, ScaffoldInspectionInput, WorkerTicket,
} from './types';

export const LICENCE_CLASSES: LicenceClass[] = ['Basic', 'Intermediate', 'Advanced'];
export const licenceRank = (c: string | null | undefined) => {
  const i = LICENCE_CLASSES.findIndex((x) => x.toLowerCase() === (c ?? '').toLowerCase());
  return i + 1;
};

/** Best current scaffolding licence class from a person's tickets (not expired, not archived). */
export function bestScaffoldLicence(tickets: WorkerTicket[], profileId: string, today = perthToday()): LicenceClass | null {
  const ok = tickets.filter((t) => t.profile_id === profileId && !t.archived_at && /scaffold/i.test(t.ticket_type)
    && licenceRank(t.licence_class) > 0 && (!t.expires_on || t.expires_on >= today));
  ok.sort((a, b) => licenceRank(b.licence_class) - licenceRank(a.licence_class));
  return (ok[0]?.licence_class as LicenceClass | undefined) ?? null;
}

export const checklistItems = (sections: ChecklistSection[]) => sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s })));

/** Why this inspection can't be signed off yet (null = OK). Same rules as the database trigger. */
export function inspectionProblem(cl: ScaffoldChecklist, input: Pick<ScaffoldInspectionInput, 'items' | 'outcome' | 'restriction' | 'signature'>) {
  const missing = checklistItems(cl.sections).filter((i) => !['pass', 'fail', 'na'].includes(input.items[i.id]?.result ?? ''));
  if (missing.length) return `Answer every checklist item (${missing.length} left)`;
  if (!input.outcome) return 'Choose the outcome';
  if (input.outcome === 'safe' && failedCount(cl, input.items) > 0) return "A scaffold can't be Safe for Use while any checklist item has failed";
  if (input.outcome === 'restricted' && !input.restriction?.trim()) return 'Write the restriction, for example "Light duty only, max 2 persons"';
  if (!input.signature) return 'Sign the inspection';
  return null;
}

export const failedCount = (cl: ScaffoldChecklist, items: ScaffoldInspectionInput['items']) =>
  checklistItems(cl.sections).filter((i) => items[i.id]?.result === 'fail').length;

/** Next inspection due: Perth day of signing + the project's interval (none when Unsafe). */
export function nextDueFor(outcome: InspectionOutcome, signedAt: string, intervalDays = 30) {
  return outcome === 'unsafe' ? null : addDays(perthToday(new Date(signedAt)), intervalDays);
}

/** What the scaffold's status means right now — an overdue inspection overrides Safe / Restricted. */
export type LiveStatus = 'safe' | 'restricted' | 'unsafe' | 'dismantled' | 'overdue' | 'awaiting';
export function liveStatus(s: Pick<Scaffold, 'status' | 'next_inspection_due' | 'last_inspection_id'>, today = perthToday()): LiveStatus {
  if (s.status === 'dismantled') return 'dismantled';
  if (!s.last_inspection_id && s.status === 'unsafe') return 'awaiting';
  if ((s.status === 'safe' || s.status === 'restricted') && s.next_inspection_due && s.next_inspection_due < today) return 'overdue';
  return s.status;
}

export const dueSoon = (s: Pick<Scaffold, 'status' | 'next_inspection_due'>, days = 7, today = perthToday()) =>
  (s.status === 'safe' || s.status === 'restricted') && !!s.next_inspection_due && s.next_inspection_due >= today && s.next_inspection_due <= addDays(today, days);

/** Starter checklist — same as the database seed (version 1). */
export const STARTER_CHECKLIST: ChecklistSection[] = [
  { id: 'foundations', title: 'Foundations, base plates and sole boards', items: [
    { id: 'fnd-ground', label: 'Ground is firm, level and able to take the load' },
    { id: 'fnd-plates', label: 'Base plates fitted to every standard' },
    { id: 'fnd-soles', label: 'Sole boards in place and the right size' },
    { id: 'fnd-jacks', label: 'Adjustable bases within extension limits' }] },
  { id: 'frame', title: 'Standards, ledgers and transoms', items: [
    { id: 'frm-plumb', label: 'Standards plumb, joints staggered' },
    { id: 'frm-ledgers', label: 'Ledgers level and secured at every lift' },
    { id: 'frm-transoms', label: 'Transoms at correct spacing for the duty class' },
    { id: 'frm-fittings', label: 'Couplers and fittings tight, no damaged components' }] },
  { id: 'bracing', title: 'Bracing', items: [
    { id: 'brc-face', label: 'Face (longitudinal) bracing in place' },
    { id: 'brc-plan', label: 'Plan and ledger bracing in place where required' }] },
  { id: 'ties', title: 'Ties and anchors', items: [
    { id: 'tie-spacing', label: 'Ties at the designed spacing' },
    { id: 'tie-secure', label: 'Ties and anchors secure and undamaged' }] },
  { id: 'platforms', title: 'Platforms and decking', items: [
    { id: 'plt-full', label: 'Platforms fully decked, no gaps' },
    { id: 'plt-secure', label: 'Planks / decks secured against uplift and movement' },
    { id: 'plt-width', label: 'Platform width suitable for the work' }] },
  { id: 'edges', title: 'Guardrails, midrails and toeboards', items: [
    { id: 'edg-guard', label: 'Guardrails at the correct height on all open sides' },
    { id: 'edg-mid', label: 'Midrails fitted' },
    { id: 'edg-toe', label: 'Toeboards fitted' }] },
  { id: 'access', title: 'Access (ladders and stairs)', items: [
    { id: 'acc-safe', label: 'Safe access to every working platform' },
    { id: 'acc-ladders', label: 'Ladders secured and extend 900 mm above the landing' },
    { id: 'acc-gates', label: 'Access gates / trapdoors self-closing' }] },
  { id: 'containment', title: 'Containment and mesh', items: [
    { id: 'cnt-mesh', label: 'Mesh / containment fitted where required' },
    { id: 'cnt-drop', label: 'Drop zone / exclusion zone in place' }] },
  { id: 'clearance', title: 'Clearance from powerlines and plant', items: [
    { id: 'clr-power', label: 'Safe clearance from powerlines' },
    { id: 'clr-plant', label: 'Protected from mobile plant and traffic' }] },
  { id: 'signage', title: 'Load signage', items: [
    { id: 'sig-load', label: 'Duty class and maximum load per bay signage displayed' },
    { id: 'sig-tag', label: 'Scaff tag holder in place at each access point' }] },
];
