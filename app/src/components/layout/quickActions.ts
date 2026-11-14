import { CheckSquare, ClipboardCheck, Clock, FileText, GraduationCap, LayoutTemplate, ShieldAlert, ShieldCheck, Truck, UserPlus, Users, type LucideIcon } from 'lucide-react';
import type { AppRole } from '../../lib/types';

export interface QuickAction {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  className: string;
}

const LOG_EVENT: QuickAction = { label: 'Log Safety Event', description: 'Incident, near miss or hazard', to: '/safety?new=1', icon: ShieldAlert, className: 'bg-red-600 text-white hover:bg-red-700' };
const NEW_DFR: QuickAction = { label: 'New Daily Field Report', description: 'Crew, hours, plant & progress', to: '/dfr?new=1', icon: FileText, className: 'bg-brand-500 text-white hover:bg-brand-600' };
const PRESTART: QuickAction = { label: 'Plant Pre-Start', description: 'Daily plant inspection', to: '/prestart?new=1', icon: Truck, className: 'bg-hivis-500 text-steel-900 hover:bg-hivis-400' };
const TRAINING: QuickAction = { label: 'My Licences', description: 'Tickets, licences & inductions', to: '/training', icon: GraduationCap, className: 'bg-emerald-700 text-white hover:bg-emerald-800' };
const CREW: QuickAction = { label: 'My Team', description: 'People and licences on your projects', to: '/people', icon: Users, className: 'bg-emerald-700 text-white hover:bg-emerald-800' };
const INVITE: QuickAction = { label: 'Add Person', description: 'Staff or subcontractor', to: '/people?add=1', icon: UserPlus, className: 'bg-steel-900 text-white hover:bg-steel-800' };
const TEMPLATE: QuickAction = { label: 'New Template', description: 'Checklist or form', to: '/admin/templates?new=1', icon: LayoutTemplate, className: 'bg-brand-800 text-white hover:bg-brand-900' };
const TIMESHEET: QuickAction = { label: 'Timesheet', description: 'Hours for the week', to: '/timesheets?new=1', icon: Clock, className: 'bg-brand-700 text-white hover:bg-brand-800' };
const TAKE5: QuickAction = { label: 'Take 5', description: 'Step-back risk check', to: '/risk?new=1', icon: ShieldCheck, className: 'bg-violet-700 text-white hover:bg-violet-800' };
const APPROVALS: QuickAction = { label: 'Approvals', description: 'Waiting for your decision', to: '/approvals', icon: CheckSquare, className: 'bg-steel-700 text-white hover:bg-steel-800' };
const AUDIT: QuickAction = { label: 'Start Audit', description: 'Site inspection', to: '/audits?new=1', icon: ClipboardCheck, className: 'bg-steel-700 text-white hover:bg-steel-800' };

export function quickActionsFor(role: AppRole): QuickAction[] {
  switch (role) {
    case 'admin':
      return [LOG_EVENT, APPROVALS, NEW_DFR, AUDIT, INVITE, TEMPLATE];
    case 'hset':
      return [LOG_EVENT, APPROVALS, AUDIT, NEW_DFR, PRESTART, TEMPLATE];
    case 'project_manager':
    case 'supervisor':
      return [LOG_EVENT, APPROVALS, NEW_DFR, PRESTART, AUDIT, CREW];
    case 'worker':
    default:
      return [LOG_EVENT, NEW_DFR, PRESTART, TAKE5, TIMESHEET, TRAINING];
  }
}
