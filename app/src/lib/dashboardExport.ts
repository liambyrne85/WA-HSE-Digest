// Table builders shared by the dashboard drill-downs, CSV and PDF export.
import type { DashData, DashFilters } from './dashboard';
import { tileIncidents, tileInvestigations, tileLeadership, tilePrestarts } from './dashboard';
import { downloadFile, toCsv } from './csv';
import { INCIDENT_CATEGORY, INVESTIGATION_STATUS, ROLE_LABEL, daysUntil, formatAnswerDate, formatDate, formatDateTime } from './labels';

export interface ExportTable { key: TileKey; title: string; head: string[]; body: (string | number)[][] }
export type TileKey = 'prestarts' | 'investigations' | 'incidents' | 'leadership';

export function buildTables(f: DashFilters, d: DashData): Record<TileKey, ExportTable> {
  const person = (id: string | null) => d.profiles.find((p) => p.id === id)?.full_name ?? '';
  const project = (id: string | null) => { const p = d.projects.find((x) => x.id === id); return p ? (p.code ? `${p.code} – ${p.name}` : p.name) : ''; };
  const vehicle = (id: string | null) => d.vehicles.find((v) => v.id === id)?.fleet_number ?? '';
  const t1 = tilePrestarts(f, d);
  const t2 = tileInvestigations(f, d);
  const t3 = tileIncidents(f, d);
  const t4 = tileLeadership(f, d);
  const rec = (id: string | null) => d.records.find((r) => r.id === id);
  return {
    prestarts: {
      key: 'prestarts', title: 'Vehicle pre-starts',
      head: ['Issue', 'Date', 'Fleet no.', 'Rego', 'Type', 'Project', 'Detail', 'Record'],
      body: [
        ...t1.missed.map((m) => ['Not done', formatDate(m.date), m.vehicle.fleet_number, m.vehicle.rego ?? '', m.vehicle.vehicle_type ?? '', project(m.vehicle.project_id), '', '']),
        ...t1.failed.map((r) => ['Failed items', formatDate(r.record_date), vehicle(r.vehicle_id), d.vehicles.find((v) => v.id === r.vehicle_id)?.rego ?? '', '',
          project(r.project_id), `${r.summary?.failed_items} failed${Number(r.summary?.critical_failures) ? `, ${r.summary?.critical_failures} critical` : ''} · ${person(r.submitted_by)}`, r.reference ?? '']),
        ...t1.outOfService.map((v) => ['Out of service', formatDate(v.out_of_service_at), v.fleet_number, v.rego ?? '', v.vehicle_type ?? '', project(v.project_id),
          v.out_of_service_reason ?? '', rec(v.out_of_service_record_id)?.reference ?? '']),
      ],
    },
    investigations: {
      key: 'investigations', title: 'Open investigations',
      head: ['Reference', 'Incident', 'Project', 'Lead', 'Status', 'Opened', 'Due', 'Overdue (days)'],
      body: t2.open.map((i) => {
        const left = daysUntil(i.due_date);
        return [i.reference ?? '', rec(i.incident_id)?.reference ?? '', project(i.project_id), person(i.lead_id) || 'Unassigned',
          INVESTIGATION_STATUS[i.status]?.label ?? i.status, formatDate(i.opened_at), formatDate(i.due_date), left !== null && left < 0 ? -left : ''];
      }),
    },
    incidents: {
      key: 'incidents', title: 'Incidents',
      head: ['Reference', 'Date', 'Category', 'Event type', 'Severity', 'Project', 'Reported by', 'Status'],
      body: t3.incidents.map((r) => [r.reference ?? '', r.answers?.['q-when'] ? formatAnswerDate(String(r.answers['q-when'])) : formatDate(r.record_date),
        INCIDENT_CATEGORY[String(r.summary?.incident_category)]?.label ?? '', String(r.summary?.event_type ?? ''), String(r.summary?.severity ?? ''),
        project(r.project_id), person(r.submitted_by), r.status.replace(/_/g, ' ')]),
    },
    leadership: {
      key: 'leadership', title: 'Field leadership vs target',
      head: ['Leader', 'Role', 'Project', 'Completed', 'Target', '% of target', 'RAG'],
      body: t4.rows.map((r) => [r.profile.full_name, ROLE_LABEL[r.profile.role], r.projects.join(', '), r.completed, r.target ?? '—',
        r.pct === null ? '—' : `${r.pct}%`, r.rag === 'none' ? 'No target' : r.rag.toUpperCase()]),
    },
  };
}

export function filterSummary(f: DashFilters, d: DashData) {
  const proj = d.projects.find((p) => p.id === f.projectId);
  const leader = d.profiles.find((p) => p.id === f.leaderId);
  return [`${formatDate(f.from)} to ${formatDate(f.to)}`, proj ? `Project: ${proj.code || proj.name}` : 'All projects', leader ? `Leader: ${leader.full_name}` : 'All leaders'].join(' · ');
}

export function exportCsv(t: ExportTable, f: DashFilters) {
  downloadFile(`${t.key}_${f.from}_${f.to}.csv`, '﻿' + toCsv([t.head, ...t.body]));
}

export async function exportPdf(tables: ExportTable[], counts: { label: string; value: string }[], title: string, subtitle: string, f: DashFilters) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand-500').trim().split(/\s+/).map(Number);
  const colour: [number, number, number] = brand.length === 3 && brand.every((n) => !Number.isNaN(n)) ? [brand[0]!, brand[1]!, brand[2]!] : [30, 64, 120];
  doc.setFontSize(18); doc.text(title, 14, 16);
  doc.setFontSize(10); doc.setTextColor(90); doc.text(subtitle, 14, 23);
  doc.text(`Printed ${formatDateTime(new Date().toISOString())} (Perth)`, 283, 16, { align: 'right' });
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 28, head: [counts.map((c) => c.label)], body: [counts.map((c) => c.value)],
    headStyles: { fillColor: colour }, styles: { fontSize: 10, halign: 'center' },
  });
  for (const t of tables) {
    const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30) + 10;
    doc.setFontSize(13); doc.text(`${t.title} (${t.body.length})`, 14, y);
    autoTable(doc, {
      startY: y + 3, head: [t.head], body: t.body.length ? t.body.map((r) => r.map(String)) : [[{ content: 'Nothing to show', colSpan: t.head.length }]],
      headStyles: { fillColor: colour }, styles: { fontSize: 8.5, cellPadding: 1.6 }, theme: 'striped',
    });
  }
  doc.save(`safety-dashboard_${f.from}_${f.to}.pdf`);
}
