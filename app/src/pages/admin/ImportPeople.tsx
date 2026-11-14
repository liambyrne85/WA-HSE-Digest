import { clsx } from 'clsx';
import { CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Card, Checkbox } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import type { ImportResult, PersonInput } from '../../lib/api/types';
import { downloadFile, parseAuDate, parseCsv, toCsv } from '../../lib/csv';
import { ROLES, ROLE_LABEL } from '../../lib/labels';
import type { AppRole, JobRole, Organization, Project } from '../../lib/types';
import { errMsg } from '../../lib/useAsync';

const COLUMNS = ['full_name', 'email', 'mobile', 'employee_id', 'company', 'role', 'position', 'primary_project', 'start_date', 'scaffold_inspector'] as const;
const EXAMPLE = [
  ['Jordan Reid', 'jordan.reid@example.com.au', '0400 333 444', 'E-1040', '', 'Worker', 'Scaffolder', 'PHW', '16/01/2023', 'yes'],
  ['Alice Nguyen', 'alice@acme.example', '0412 555 101', '', 'Acme Scaffolding Pty Ltd', 'Supervisor', 'Supervisor', 'PHW', '01/02/2026', 'no'],
];

interface Row { line: number; input: PersonInput | null; errors: string[]; raw: Record<string, string> }

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export default function ImportPeople({ orgs, positions, projects, existingEmails, onDone }: {
  orgs: Organization[]; positions: JobRole[]; projects: Project[]; existingEmails: string[]; onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sendInvites, setSendInvites] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const internal = orgs.find((o) => o.type === 'internal');

  const validate = (text: string) => {
    const table = parseCsv(text);
    if (table.length < 2) throw new Error('The file has no rows under the header');
    const header = table[0]!.map(norm);
    const idx = (k: string, ...alts: string[]) => [k, ...alts].map(norm).map((h) => header.indexOf(h)).find((i) => i >= 0) ?? -1;
    const col = {
      full_name: idx('full_name', 'name', 'fullname'), email: idx('email'), mobile: idx('mobile', 'phone'),
      employee_id: idx('employee_id', 'employeeid', 'employee_number'), company: idx('company'), role: idx('role', 'app_role'),
      position: idx('position', 'job'), primary_project: idx('primary_project', 'project'), start_date: idx('start_date', 'start'),
      scaffold_inspector: idx('scaffold_inspector', 'inspector', 'competent_scaffold_inspector'),
    };
    if (col.full_name < 0 || col.email < 0) throw new Error('The header row must include full_name and email columns');
    const seen = new Set<string>();
    return table.slice(1).map((cells, i): Row => {
      const get = (k: keyof typeof col) => (col[k] >= 0 ? (cells[col[k]] ?? '').trim() : '');
      const raw = Object.fromEntries(COLUMNS.map((k) => [k, get(k)]));
      const errors: string[] = [];
      const email = get('email').toLowerCase();
      if (!get('full_name')) errors.push('Name missing');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('Email invalid');
      else if (existingEmails.includes(email)) errors.push('Already in the app');
      else if (seen.has(email)) errors.push('Duplicate email in file');
      seen.add(email);
      const companyName = get('company');
      const org = companyName ? orgs.find((o) => norm(o.name) === norm(companyName)) : internal;
      if (!org) errors.push(`Company "${companyName}" not found — add it under Companies first`);
      const roleText = get('role') || 'Worker';
      const role = ROLES.find((r) => norm(ROLE_LABEL[r]) === norm(roleText) || norm(r) === norm(roleText)) as AppRole | undefined;
      if (!role) errors.push(`Role "${roleText}" not recognised`);
      else if (org?.type === 'contractor' && (role === 'admin' || role === 'hset')) errors.push(`${ROLE_LABEL[role]} must be at your own company`);
      const posText = get('position');
      const pos = posText ? positions.find((j) => norm(j.name) === norm(posText)) : undefined;
      if (posText && !pos) errors.push(`Position "${posText}" not found`);
      const projText = get('primary_project');
      const proj = projText ? projects.find((p) => norm(p.code ?? '') === norm(projText) || norm(p.name) === norm(projText)) : undefined;
      if (projText && !proj) errors.push(`Project "${projText}" not found`);
      const dateText = get('start_date');
      const start = dateText ? parseAuDate(dateText) : null;
      if (dateText && !start) errors.push('Start date must be DD/MM/YYYY');
      const insp = /^(y|yes|true|1)$/i.test(get('scaffold_inspector'));
      return {
        line: i + 2, raw, errors,
        input: errors.length ? null : {
          full_name: get('full_name'), email, phone: get('mobile') || null, employee_number: get('employee_id') || null,
          organization_id: org!.id, role: role!, job_role_id: pos?.id ?? null, primary_project_id: proj?.id ?? null,
          start_date: start, is_scaffold_inspector: insp,
        },
      };
    });
  };

  const ok = rows?.filter((r) => r.input) ?? [];
  const bad = rows?.filter((r) => !r.input) ?? [];

  const runImport = async () => {
    setBusy(true);
    try {
      const res = await api.importPeople(ok.map((r) => r.input!), sendInvites);
      setResults(res);
      const n = res.filter((r) => r.ok).length;
      toast(`${n} of ${res.length} people added`, n === res.length ? 'success' : 'error');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (results) {
    return (
      <Card title="Import results" padded={false}>
        <ul className="divide-y divide-steel-100">
          {results.map((r) => (
            <li key={r.row} className="flex items-center gap-3 px-4 py-2 text-sm">
              {r.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="h-5 w-5 shrink-0 text-red-600" />}
              <span className="min-w-0 flex-1 truncate font-semibold">{r.email}</span>
              <span className={clsx('text-xs', r.ok ? 'text-steel-500' : 'font-semibold text-red-700')}>
                {r.ok ? (sendInvites ? (r.invited ? 'Invite emailed' : 'Added — invite email not sent') : 'Added') : r.error}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 border-t border-steel-100 p-3">
          <Button onClick={onDone}>Done</Button>
          <Button variant="secondary" onClick={() => { setResults(null); setRows(null); }}>Import another file</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="1 · Prepare the file">
        <p className="text-sm text-steel-700">
          One row per person. Required: <b>full_name</b> and <b>email</b>. Optional: mobile, employee_id, company (blank = your company),
          role (Admin, HSET, Project Manager, Supervisor or Worker; blank = Worker), position, primary_project (project code or name),
          start_date (DD/MM/YYYY) and scaffold_inspector (yes/no).
        </p>
        <Button className="mt-3" variant="secondary" icon={<Download className="h-5 w-5" />}
          onClick={() => downloadFile('people-import-template.csv', toCsv([[...COLUMNS], ...EXAMPLE]))}>Download template</Button>
      </Card>

      <Card title="2 · Choose the file">
        <Button size="lg" icon={<FileUp className="h-5 w-5" />} onClick={() => fileRef.current?.click()}>{fileName ? 'Choose a different file' : 'Choose CSV file'}</Button>
        {fileName && <span className="ml-3 text-sm text-steel-600">{fileName}</span>}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setFileName(f.name);
          try { setRows(validate(await f.text())); } catch (err) { setRows(null); toast(errMsg(err), 'error'); }
        }} />
      </Card>

      {rows && (
        <Card title={`3 · Check and import · ${ok.length} ready${bad.length ? `, ${bad.length} with problems` : ''}`} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-steel-50 text-xs font-bold uppercase text-steel-500">
                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Role</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Check</th></tr>
              </thead>
              <tbody className="divide-y divide-steel-100">
                {rows.map((r) => (
                  <tr key={r.line} className={r.input ? '' : 'bg-red-50'}>
                    <td className="px-3 py-2 tabular-nums text-steel-500">{r.line}</td>
                    <td className="px-3 py-2 font-semibold">{r.raw.full_name}</td>
                    <td className="px-3 py-2">{r.raw.email}</td>
                    <td className="px-3 py-2">{r.raw.company || 'Your company'}</td>
                    <td className="px-3 py-2">{r.raw.role || 'Worker'}</td>
                    <td className="px-3 py-2">{r.raw.primary_project || '—'}</td>
                    <td className="px-3 py-2">{r.input ? <span className="font-semibold text-emerald-700">Ready</span> : <span className="font-semibold text-red-700">{r.errors.join('; ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 border-t border-steel-100 p-4">
            <Checkbox label="Email each person a link to set their password" description="Untick to add them now and send invites later from each profile."
              checked={sendInvites} onChange={setSendInvites} />
            {bad.length > 0 && <p className="text-sm text-steel-600">Rows with problems are skipped. Fix them in the file and import again.</p>}
            <Button size="lg" disabled={!ok.length} loading={busy} onClick={runImport}>Import {ok.length} {ok.length === 1 ? 'person' : 'people'}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
