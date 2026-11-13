import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import { useAuth } from './contexts/AuthContext';
import type { AppRole } from './lib/types';
import CrewPage from './pages/CrewPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ModulePlaceholderPage from './pages/ModulePlaceholderPage';
import NotFoundPage from './pages/NotFoundPage';
import PendingAccessPage from './pages/PendingAccessPage';
import ProfilePage, { PasswordCard } from './pages/ProfilePage';
import ProjectsPage from './pages/ProjectsPage';
import TrainingPage from './pages/TrainingPage';
import TemplateBuilderPage from './pages/admin/TemplateBuilderPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import UsersPage from './pages/admin/UsersPage';
import WorkflowPage from './pages/admin/WorkflowPage';

/** UI-level guard. Real enforcement is Postgres RLS; this just keeps users out of screens they can't use. */
function RequireRole({ roles, children }: { roles: AppRole[]; children: JSX.Element }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { session, profile, loading } = useAuth();

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (!profile || !profile.is_active) return <PendingAccessPage />;
  if (session.mustChangePassword) {
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
        <Route path="/crew" element={<RequireRole roles={['contractor']}><CrewPage /></RequireRole>} />
        <Route path="/safety" element={<ModulePlaceholderPage module="safety_event" />} />
        <Route path="/dfr" element={<ModulePlaceholderPage module="daily_field_report" />} />
        <Route path="/prestart" element={<ModulePlaceholderPage module="plant_prestart" />} />
        <Route path="/audits" element={<RequireRole roles={['leader', 'employee']}><ModulePlaceholderPage module="audit" /></RequireRole>} />
        <Route path="/admin/users" element={<RequireRole roles={['leader']}><UsersPage /></RequireRole>} />
        <Route path="/admin/templates" element={<RequireRole roles={['leader']}><TemplatesPage /></RequireRole>} />
        <Route path="/admin/templates/:id" element={<RequireRole roles={['leader']}><TemplateBuilderPage /></RequireRole>} />
        <Route path="/admin/workflow" element={<RequireRole roles={['leader']}><WorkflowPage /></RequireRole>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}
