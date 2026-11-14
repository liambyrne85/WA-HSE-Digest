import { useEffect } from 'react';
import { Navigate, Route, Routes, useMatch, useNavigate } from 'react-router-dom';
import PublicScaffoldPage, { AFTER_LOGIN_KEY } from './pages/PublicScaffoldPage';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import { useAuth } from './contexts/AuthContext';
import type { AppRole } from './lib/types';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ModulePage from './pages/ModulePage';
import RecordDetailPage from './pages/RecordDetailPage';
import RecordFormPage from './pages/RecordFormPage';
import BrandingPage from './pages/admin/BrandingPage';
import NotFoundPage from './pages/NotFoundPage';
import PendingAccessPage from './pages/PendingAccessPage';
import ProfilePage, { PasswordCard } from './pages/ProfilePage';
import ProjectsPage from './pages/ProjectsPage';
import TrainingPage from './pages/TrainingPage';
import TemplateBuilderPage from './pages/admin/TemplateBuilderPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import PeoplePage from './pages/admin/PeoplePage';
import PersonPage from './pages/PersonPage';
import WorkflowPage from './pages/admin/WorkflowPage';
import VehiclesPage from './pages/VehiclesPage';
import ActionsPage from './pages/ActionsPage';
import ActionDetailPage from './pages/ActionDetailPage';
import ScaffoldsPage from './pages/scaffolds/ScaffoldsPage';
import ScaffoldDetailPage from './pages/scaffolds/ScaffoldDetailPage';
import ScaffoldInspectPage from './pages/scaffolds/ScaffoldInspectPage';
import ScaffoldInspectionPage from './pages/scaffolds/ScaffoldInspectionPage';
import ScaffoldSettingsPage from './pages/admin/ScaffoldSettingsPage';
import InvestigationsPage, { InvestigationDetailPage } from './pages/InvestigationsPage';

/** UI-level guard. Real enforcement is Postgres RLS; this just keeps users out of screens they can't use. */
function RequireRole({ roles, children }: { roles: AppRole[]; children: JSX.Element }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { session, profile, loading } = useAuth();
  const qr = useMatch('/s/:token');
  const nav = useNavigate();
  // Back to the scaffold page a QR code opened, after signing in.
  useEffect(() => {
    if (!session || !profile?.is_active) return;
    let next: string | null = null;
    try { next = sessionStorage.getItem(AFTER_LOGIN_KEY); sessionStorage.removeItem(AFTER_LOGIN_KEY); } catch { /* ignore */ }
    if (next) nav(next, { replace: true });
  }, [session, profile, nav]);

  // A scaff tag's QR page: open to anyone (the server decides if a sign-in is needed).
  if (qr?.params.token) return <PublicScaffoldPage token={qr.params.token} />;
  const sParam = (() => { try { return new URLSearchParams(window.location.search).get('s'); } catch { return null; } })();
  if (sParam && /^[0-9a-f]{32,128}$/.test(sParam)) return <PublicScaffoldPage token={sParam} />;
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (!profile || !profile.is_active) return <PendingAccessPage />;
  if (session.mustChangePassword || session.recovery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-steel-900 p-4">
        <div className="w-full max-w-lg"><PasswordCard required /></div>
      </div>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/crew" element={<Navigate to="/people" replace />} />
        <Route path="/people" element={<RequireRole roles={['admin', 'hset', 'project_manager', 'supervisor']}><PeoplePage /></RequireRole>} />
        <Route path="/people/:id" element={<PersonPage />} />
        <Route path="/safety" element={<ModulePage key="safety_event" module="safety_event" />} />
        <Route path="/dfr" element={<ModulePage key="daily_field_report" module="daily_field_report" />} />
        <Route path="/timesheets" element={<ModulePage key="timesheet" module="timesheet" />} />
        <Route path="/prestart" element={<ModulePage key="plant_prestart" module="plant_prestart" />} />
        <Route path="/risk" element={<ModulePage key="risk_assessment" module="risk_assessment" />} />
        <Route path="/leadership" element={<RequireRole roles={['admin', 'hset', 'project_manager', 'supervisor']}><ModulePage key="field_leadership" module="field_leadership" /></RequireRole>} />
        <Route path="/vehicles" element={<VehiclesPage />} />
        <Route path="/actions" element={<ActionsPage />} />
        <Route path="/actions/:id" element={<ActionDetailPage />} />
        <Route path="/scaffolds" element={<ScaffoldsPage />} />
        <Route path="/scaffolds/inspections/:id" element={<ScaffoldInspectionPage />} />
        <Route path="/scaffolds/:id" element={<ScaffoldDetailPage />} />
        <Route path="/scaffolds/:id/inspect" element={<ScaffoldInspectPage />} />
        <Route path="/admin/scaffolds" element={<RequireRole roles={['admin']}><ScaffoldSettingsPage /></RequireRole>} />
        <Route path="/investigations" element={<RequireRole roles={['admin', 'hset', 'project_manager', 'supervisor']}><InvestigationsPage /></RequireRole>} />
        <Route path="/investigations/:id" element={<InvestigationDetailPage />} />
        <Route path="/audits" element={<RequireRole roles={['admin', 'hset', 'project_manager', 'supervisor']}><ModulePage key="audit" module="audit" /></RequireRole>} />
        <Route path="/records/new" element={<RecordFormPage />} />
        <Route path="/records/:id" element={<RecordDetailPage />} />
        <Route path="/records/:id/edit" element={<RecordFormPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/admin/branding" element={<RequireRole roles={['admin']}><BrandingPage /></RequireRole>} />
        <Route path="/admin/users" element={<Navigate to="/people" replace />} />
        <Route path="/admin/templates" element={<RequireRole roles={['admin', 'hset']}><TemplatesPage /></RequireRole>} />
        <Route path="/admin/templates/:id" element={<RequireRole roles={['admin', 'hset']}><TemplateBuilderPage /></RequireRole>} />
        <Route path="/admin/workflow" element={<RequireRole roles={['admin', 'hset']}><WorkflowPage /></RequireRole>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}
