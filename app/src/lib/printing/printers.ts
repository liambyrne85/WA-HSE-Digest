// Printing service. Every printer implements TagPrinter, so a direct connection to a
// label printer can be added later without touching the screens:
//   * Zebra (ZD/ZQ series): send ZPL over Bluetooth / Wi-Fi via Zebra Browser Print
//     or the Zebra Link-OS SDK — add a `zebraPrinter` with kind 'direct'.
//   * Brother (QL/TD series): Brother iPrint&Label / b-PAC SDK — add `brotherPrinter`.
// Until a printer is chosen, `pdfPrinter` makes a PDF at the exact label size and
// opens the device's normal print dialog (AirPrint, Android print service, Windows).
import type { LabelSize } from './labels';
import { renderTagPdf, type TagData } from './tag';

export interface PrintJob { tag: TagData; size: LabelSize; copies: number }
export interface TagPrinter {
  id: string;
  name: string;
  kind: 'pdf' | 'direct';
  /** true if this printer can be used on this device right now */
  available(): Promise<boolean>;
  print(job: PrintJob): Promise<void>;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const pdfPrinter: TagPrinter = {
  id: 'pdf',
  name: 'Print dialog (any printer)',
  kind: 'pdf',
  async available() { return true; },
  async print(job) {
    const doc = await renderTagPdf(job.tag, job.size, job.copies);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    if (isIOS()) {
      // iOS can't print a PDF from a hidden frame: open it, then Share → Print.
      window.open(url, '_blank');
      return;
    }
    await new Promise<void>((resolve) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.open(url, '_blank'); }
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
        resolve();
      };
      document.body.appendChild(frame);
    });
  },
};

/** All printers this app knows about. Add direct printers here when one is chosen. */
export const PRINTERS: TagPrinter[] = [pdfPrinter];

export async function downloadTagPdf(job: PrintJob, fileName: string) {
  const doc = await renderTagPdf(job.tag, job.size, job.copies);
  doc.save(fileName);
}
