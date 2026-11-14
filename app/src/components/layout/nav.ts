import {
  Car, CheckSquare, ListChecks, Construction, SlidersHorizontal, ClipboardCheck, Clock, FileText, GraduationCap, Home, LayoutTemplate, MapPin, Palette, Search, Target,
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

const ALL: AppRole[] = ['admin', 'hset', 'project_manager', 'supervisor', 'worker'];
const LEADS: AppRole[] = ['admin', 'hset', 'project_manager', 'supervisor'];
const ADMIN_HSET: AppRole[] = ['admin', 'hset'];

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, roles: ALL, section: 'main' },
  { to: '/actions', label: 'Actions', icon: ListChecks, roles: ALL, section: 'main' },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, roles: LEADS, section: 'main' },
  { to: '/projects', label: 'Projects & Sites', icon: MapPin, roles: ALL, section: 'main' },
  { to: '/scaffolds', label: 'Scaffolds', icon: Construction, roles: ALL, section: 'modules' },
  { to: '/safety', label: 'Safety Events', icon: ShieldAlert, roles: ALL, section: 'modules' },
  { to: '/dfr', label: 'Daily Field Reports', icon: FileText, roles: ALL, section: 'modules' },
  { to: '/timesheets', label: 'Timesheets', icon: Clock, roles: ALL, section: 'modules' },
  { to: '/prestart', label: 'Pre-Starts', icon: Truck, roles: ALL, section: 'modules' },
  { to: '/vehicles', label: 'Vehicles & Plant', icon: Car, roles: ALL, section: 'modules' },
  { to: '/investigations', label: 'Investigations', icon: Search, roles: LEADS, section: 'modules' },
  { to: '/leadership', label: 'Field Leadership', icon: Target, roles: LEADS, section: 'modules' },
  { to: '/risk', label: 'Risk Assessments', icon: ShieldCheck, roles: ALL, section: 'modules' },
  { to: '/audits', label: 'Audits & Inspections', icon: ClipboardCheck, roles: LEADS, section: 'modules' },
  {
    to: '/training', label: 'Licences & Tickets', icon: GraduationCap, roles: ALL, section: 'modules',
    labelFor: { worker: 'My Licences' },
  },
  { to: '/people', label: 'People', icon: Users, roles: LEADS, section: 'admin', labelFor: { project_manager: 'My Team', supervisor: 'My Team' } },
  { to: '/admin/templates', label: 'Form Templates', icon: LayoutTemplate, roles: ADMIN_HSET, section: 'admin' },
  { to: '/admin/workflow', label: 'Workflow Settings', icon: Workflow, roles: ADMIN_HSET, section: 'admin' },
  { to: '/admin/scaffolds', label: 'Scaffold Settings', icon: SlidersHorizontal, roles: ['admin'], section: 'admin' },
  { to: '/admin/branding', label: 'Branding', icon: Palette, roles: ['admin'], section: 'admin' },
  { to: '/profile', label: 'My Profile', icon: User, roles: ALL, section: 'account' },
];

export const SECTION_LABEL: Record<NavItem['section'], string> = {
  main: '',
  modules: 'Field Modules',
  admin: 'People & Settings',
  account: 'Account',
};

export function navFor(role: AppRole) {
  return NAV.filter((n) => n.roles.includes(role)).map((n) => ({ ...n, label: n.labelFor?.[role] ?? n.label }));
}

