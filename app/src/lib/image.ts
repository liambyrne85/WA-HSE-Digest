// Phone photos are 3–8 MB; field coverage is poor. Resize + JPEG-compress on the
// device before upload, and optionally stamp the date/time (Perth) on the image.
import { formatDateTime } from './labels';

export async function compressImage(file: Blob, opts: { maxDim?: number; quality?: number; stamp?: string | boolean } = {}): Promise<Blob> {
  const { maxDim = 1600, quality = 0.72 } = opts;
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    if (opts.stamp) {
      const text = typeof opts.stamp === 'string' ? opts.stamp : formatDateTime(new Date().toISOString());
      const size = Math.max(14, Math.round(w / 40));
      ctx.font = `bold ${size}px sans-serif`;
      const pad = size * 0.5;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(w - tw - pad * 3, h - size - pad * 3, tw + pad * 2, size + pad * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, w - tw - pad * 2, h - pad * 2);
    }
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not compress image'))), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as string);
  r.onerror = () => rej(new Error('Could not read file'));
  r.readAsDataURL(b);
});
