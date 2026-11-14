// Scaff tag layout for black-and-white thermal printers: status shown with text and
// a thick border (never colour); QR code at least 25 mm square so it scans reliably.
import type { jsPDF } from 'jspdf';
import type { LabelSize } from './labels';

export type TagStatus = 'safe' | 'restricted' | 'unsafe' | 'overdue' | 'awaiting' | 'dismantled';
export interface TagData {
  company: string;
  /** data: URL (PNG/JPEG) of the company logo, if it could be loaded */
  logo?: string | null;
  scaffoldNumber: string;
  project: string;
  location: string;
  status: TagStatus;
  restriction?: string | null;
  dutyClass: string;
  maxLoad?: string | null;
  inspectedBy?: string | null;
  inspectedAt?: string | null;
  nextDue?: string | null;
  /** the scaffold's permanent QR page link */
  qrUrl: string;
}

export const TAG_STATUS_TEXT: Record<TagStatus, string> = {
  safe: 'SAFE FOR USE',
  restricted: 'RESTRICTED USE',
  unsafe: 'UNSAFE – DO NOT USE',
  overdue: 'INSPECTION OVERDUE – DO NOT USE',
  awaiting: 'UNSAFE – DO NOT USE',
  dismantled: 'DISMANTLED – NOT IN SERVICE',
};

export async function qrDataUrl(text: string) {
  const QR = await import('qrcode');
  // Pure black on white, error correction M, 2-module quiet zone: scans at 25 mm.
  return QR.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, scale: 10, color: { dark: '#000000', light: '#ffffff' } });
}

/** One page per copy, each exactly the label size. */
export async function renderTagPdf(d: TagData, size: LabelSize, copies = 1): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const W = size.widthMm;
  const H = size.heightMm;
  const orientation = W > H ? 'landscape' : 'portrait';
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation });
  const qr = await qrDataUrl(d.qrUrl);
  for (let i = 0; i < Math.max(1, copies); i++) {
    if (i > 0) doc.addPage([W, H], orientation);
    drawTag(doc, d, W, H, qr);
  }
  return doc;
}

function drawTag(doc: jsPDF, d: TagData, W: number, H: number, qrImage: string) {
  const k = Math.min(W / 100, H / 150) || 1; // scale against the 100 × 150 design
  const m = Math.max(3, 4 * k);
  const inner = W - m * 2;
  const pt = (mm: number) => mm * 2.835; // mm of cap height → font points (approx.)
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  let y = m;

  // Header: logo + company
  const headH = 9 * k;
  let tx = m;
  if (d.logo) {
    try {
      const props = doc.getImageProperties(d.logo);
      const lw = Math.min(headH * (props.width / props.height), inner * 0.4);
      doc.addImage(d.logo, props.fileType, m, y, lw, headH);
      tx = m + lw + 2;
    } catch { /* logo optional */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pt(3.4 * k));
  doc.text(doc.splitTextToSize(d.company, W - tx - m).slice(0, 2), tx, y + headH * 0.62);
  y += headH + 2.5 * k;

  // Status block: thick border; black fill with white text when it must not be used.
  const danger = d.status !== 'safe' && d.status !== 'restricted';
  const statusText = TAG_STATUS_TEXT[d.status];
  let fs = 9 * k;
  doc.setFontSize(pt(fs));
  let lines = doc.splitTextToSize(statusText, inner - 6 * k) as string[];
  while (lines.length > 2 && fs > 4) { fs -= 0.5; doc.setFontSize(pt(fs)); lines = doc.splitTextToSize(statusText, inner - 6 * k); }
  const lineH = fs * 1.15;
  const boxH = lines.length * lineH + 6 * k;
  const border = 1.8 * k;
  if (danger) {
    doc.setFillColor(0, 0, 0);
    doc.rect(m, y, inner, boxH, 'F');
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setLineWidth(border);
    doc.rect(m + border / 2, y + border / 2, inner - border, boxH - border, 'S');
    if (d.status === 'restricted') { // double border marks Restricted without colour
      doc.setLineWidth(0.5 * k);
      doc.rect(m + border + 1.2 * k, y + border + 1.2 * k, inner - 2 * border - 2.4 * k, boxH - 2 * border - 2.4 * k, 'S');
    }
  }
  lines.forEach((l, i) => doc.text(l, W / 2, y + 3 * k + lineH * (i + 0.8), { align: 'center' }));
  doc.setTextColor(0, 0, 0);
  y += boxH + 3 * k;

  // Scaffold ID, project, location
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pt(5.2 * k));
  doc.text(d.scaffoldNumber, m, y + 5 * k);
  y += 7.5 * k;
  doc.setFontSize(pt(2.6 * k));
  doc.setFont('helvetica', 'normal');
  const loc = doc.splitTextToSize(`${d.project}\n${d.location}`, inner).slice(0, 3) as string[];
  doc.text(loc, m, y + 2.6 * k);
  y += loc.length * 3.4 * k + 1.5 * k;

  // Duty class and load
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pt(3 * k));
  doc.text(`${d.dutyClass}${d.maxLoad ? `  ·  max ${d.maxLoad} per bay` : ''}`, m, y + 3 * k);
  y += 5 * k;

  if (d.restriction && d.status === 'restricted') {
    doc.setFontSize(pt(2.9 * k));
    const r = doc.splitTextToSize(`RESTRICTION: ${d.restriction}`, inner).slice(0, 3) as string[];
    doc.text(r, m, y + 3 * k);
    y += r.length * 3.7 * k + 1.5 * k;
  }

  // QR code (≥ 25 mm) bottom-right; inspection details beside it.
  const qr = Math.max(25, Math.min(inner * 0.42, 40 * k));
  const qrY = Math.max(y + 1, H - m - qr - 3.5 * k);
  const qrX = W - m - qr;
  doc.addImage(qrImage, 'PNG', qrX, qrY, qr, qr);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(pt(1.9 * k));
  doc.text('Scan for live status', qrX + qr / 2, qrY + qr + 2.6 * k, { align: 'center' });

  const colW = qrX - m - 2;
  const narrow = colW < 22; // 62 mm rolls: put details above the QR instead
  const dx = m;
  let dy = narrow ? y + 1 : qrY + 2 * k;
  const detail = (label: string, value?: string | null) => {
    if (!value) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(pt(1.9 * k));
    doc.text(label.toUpperCase(), dx, dy + 2 * k);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(pt(2.6 * k));
    const v = doc.splitTextToSize(value, narrow ? inner : colW).slice(0, 2) as string[];
    doc.text(v, dx, dy + 5 * k);
    dy += 5.5 * k + v.length * 3 * k;
  };
  detail('Inspected by', d.inspectedBy);
  detail('Inspected', d.inspectedAt);
  detail('Next inspection due', d.nextDue ?? (d.status === 'dismantled' ? null : 'Before use'));
}
