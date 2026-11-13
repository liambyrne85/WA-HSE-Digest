import { ClipboardCheck, FileText, GraduationCap, LayoutTemplate, ShieldAlert, Truck, UserPlus, Users, type LucideIcon } from 'lucide-react';
import type { AppRole } from '../../lib/types';

export interface QuickAction {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  className: string;
}

const LOG_EVENT: QuickAction = { label: 'Log Safety Event', description: 'Incident, near miss or hazard', to: '/safety?new=1', icon: ShieldAlert, className: 'bg-red-600 hover:bg-red-700' };
const NEW_DFR: QuickAction = { label: 'New Daily Field Report', description: 'Crew, hours, plant & progress', to: '/dfr?new=1', icon: FileText, className: 'bg-blue-700 hover:bg-blue-800' };
const PRESTART: QuickAction = { label: 'Plant Pre-Start', description: 'Daily plant inspection', to: '/prestart?new=1', icon: Truck, className: 'bg-brand-500 hover:bg-brand-600' };
const TRAINING: QuickAction = { label: 'My Training', description: 'Tickets, licences & inductions', to: '/training', icon: GraduationCap, className: 'bg-emerald-700 hover:bg-emerald-800' };
const CREW: QuickAction = { label: 'Crew Tickets', description: "Manage your crew's tickets", to: '/training', icon: Users, className: 'bg-emerald-700 hover:bg-emerald-800' };
const INVITE: QuickAction = { label: 'Invite User', description: 'Employee, leader or contractor', to: '/admin/users?invite=1', icon: UserPlus, className: 'bg-violet-700 hover:bg-violet-800' };
const TEMPLATE: QuickAction = { label: 'New Template', description: 'Checklist or form', to: '/admin/templates?new=1', icon: LayoutTemplate, className: 'bg-steel-800 hover:bg-steel-900' };
const AUDIT: QuickAction = { label: 'Start Audit', description: 'Site inspection', to: '/audits?new=1', icon: ClipboardCheck, className: 'bg-steel-800 hover:bg-steel-900' };

export function quickActionsFor(role: AppRole): QuickAction[] {
  switch (role) {
    case 'leader':
      return [LOG_EVENT, NEW_DFR, PRESTART, TRAINING, INVITE, TEMPLATE];
    case 'employee':
      return [LOG_EVENT, NEW_DFR, PRESTART, TRAINING, AUDIT];
    case 'contractor':
      return [LOG_EVENT, NEW_DFR, PRESTART, CREW];
  }
}
