import {
  Building2, CheckSquare, ClipboardCheck, Clock, FileText, GraduationCap, Home, LayoutTemplate, MapPin, Palette,
  ShieldAlert, ShieldCheck, Truck, User, Users, Workflow, type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '../../lib/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: AppRole[];
  section: 'main' | 'modules' | 'admin' | 'account';
  phase2?: boolean;
  /** label override per role */
  labelFor?: Partial<Record<AppRole, string>>;
}

const ALL: AppRole[] = ['leader', 'employee', 'contractor'];

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, roles: ALL, section: 'main' },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, roles: ['leader'], section: 'main' },
  { to: '/projects', label: 'Projects & Sites', icon: MapPin, roles: ALL, section: 'main' },
  { to: '/safety', label: 'Safety Events', icon: ShieldAlert, roles: ALL, section: 'modules' },
  { to: '/dfr', label: 'Daily Field Reports', icon: FileText, roles: ALL, section: 'modules' },
  { to: '/timesheets', label: 'Timesheets', icon: Clock, roles: ALL, section: 'modules' },
  { to: '/prestart', label: 'Plant Pre-Starts', icon: Truck, roles: ALL, section: 'modules' },
  { to: '/risk', label: 'Risk Assessments', icon: ShieldCheck, roles: ALL, section: 'modules' },
  { to: '/audits', label: 'Audits & Inspections', icon: ClipboardCheck, roles: ['leader', 'employee'], section: 'modules' },
  {
    to: '/training', label: 'Training & Tickets', icon: GraduationCap, roles: ALL, section: 'modules',
    labelFor: { employee: 'My Training', contractor: 'Crew & Tickets' },
  },
  { to: '/admin/users', label: 'Users & Contractors', icon: Users, roles: ['leader'], section: 'admin' },
  { to: '/admin/templates', label: 'Form Templates', icon: LayoutTemplate, roles: ['leader'], section: 'admin' },
  { to: '/admin/workflow', label: 'Workflow Settings', icon: Workflow, roles: ['leader'], section: 'admin' },
  { to: '/admin/branding', label: 'Branding', icon: Palette, roles: ['leader'], section: 'admin' },
  { to: '/crew', label: 'My Company', icon: Building2, roles: ['contractor'], section: 'account' },
  { to: '/profile', label: 'My Profile', icon: User, roles: ALL, section: 'account' },
];

export const SECTION_LABEL: Record<NavItem['section'], string> = {
  main: '',
  modules: 'Field Modules',
  admin: 'Administration',
  account: 'Account',
};

export function navFor(role: AppRole) {
  return NAV.filter((n) => n.roles.includes(role)).map((n) => ({ ...n, label: n.labelFor?.[role] ?? n.label }));
}

