import { CheckSquare, ClipboardCheck, Construction, FileText, GraduationCap, LayoutTemplate, ShieldAlert, ShieldCheck, Target, Truck, UserPlus, Users, type LucideIcon } from 'lucide-react';
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
const PRESTART: QuickAction = { label: 'Vehicle Pre-Start', description: 'Pick your vehicle and check it', to: '/vehicles', icon: Truck, className: 'bg-hivis-500 text-steel-900 hover:bg-hivis-400' };
const TRAINING: QuickAction = { label: 'My Licences', description: 'Tickets, licences & inductions', to: '/training', icon: GraduationCap, className: 'bg-emerald-700 text-white hover:bg-emerald-800' };
const CREW: QuickAction = { label: 'My Team', description: 'People and licences on your projects', to: '/people', icon: Users, className: 'bg-emerald-700 text-white hover:bg-emerald-800' };
const INVITE: QuickAction = { label: 'Add Person', description: 'Staff or subcontractor', to: '/people?add=1', icon: UserPlus, className: 'bg-steel-900 text-white hover:bg-steel-800' };
const TEMPLATE: QuickAction = { label: 'New Template', description: 'Checklist or form', to: '/admin/templates?new=1', icon: LayoutTemplate, className: 'bg-brand-800 text-white hover:bg-brand-900' };
const TAKE5: QuickAction = { label: 'Take 5', description: 'Step-back risk check', to: '/risk?new=1', icon: ShieldCheck, className: 'bg-violet-700 text-white hover:bg-violet-800' };
const APPROVALS: QuickAction = { label: 'Approvals', description: 'Waiting for your decision', to: '/approvals', icon: CheckSquare, className: 'bg-steel-700 text-white hover:bg-steel-800' };
const LEADERSHIP: QuickAction = { label: 'Field Leadership', description: 'Toolbox talk, safety walk, CCV', to: '/leadership?new=1', icon: Target, className: 'bg-violet-700 text-white hover:bg-violet-800' };
const SCAFFOLDS: QuickAction = { label: 'Scaffolds', description: 'Status, inspect, tag defects', to: '/scaffolds', icon: Construction, className: 'bg-emerald-700 text-white hover:bg-emerald-800' };
const AUDIT: QuickAction = { label: 'Start Audit', description: 'Site inspection', to: '/audits?new=1', icon: ClipboardCheck, className: 'bg-steel-700 text-white hover:bg-steel-800' };

export function quickActionsFor(role: AppRole): QuickAction[] {
  switch (role) {
    case 'admin':
      return [LOG_EVENT, SCAFFOLDS, APPROVALS, LEADERSHIP, INVITE, TEMPLATE];
    case 'hset':
      return [LOG_EVENT, SCAFFOLDS, APPROVALS, LEADERSHIP, AUDIT, PRESTART];
    case 'project_manager':
    case 'supervisor':
      return [LOG_EVENT, SCAFFOLDS, LEADERSHIP, APPROVALS, PRESTART, CREW];
    case 'worker':
    default:
      return [LOG_EVENT, SCAFFOLDS, PRESTART, TAKE5, NEW_DFR, TRAINING];
  }
}
