import { Clock, LogOut } from 'lucide-react';
import { Button } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';

export default function PendingAccessPage() {
  const { profile, session, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-steel-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold uppercase">Awaiting access</h1>
        <p className="mt-2 text-steel-600">
          {profile ? `Hi ${profile.full_name.split(' ')[0]}, your` : 'Your'} account ({session?.email}) has been created but hasn't been
          activated yet. A Leader needs to approve your access and assign your role and company.
        </p>
        <p className="mt-3 text-sm text-steel-500">If you were expecting an invitation, check you signed in with the same email address it was sent to.</p>
        <Button className="mt-6" variant="secondary" block size="lg" icon={<LogOut className="h-5 w-5" />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
