// Label sizes for printed scaff tags (Admin setting). Sizes are in millimetres.
import type { AppSettings, LabelSizeKey } from '../types';

export interface LabelSize { key: LabelSizeKey; label: string; widthMm: number; heightMm: number }

export const LABEL_PRESETS: Record<Exclude<LabelSizeKey, 'custom'>, LabelSize> = {
  '100x150': { key: '100x150', label: '100 × 150 mm', widthMm: 100, heightMm: 150 },
  '4x6': { key: '4x6', label: '4" × 6" (102 × 152 mm)', widthMm: 101.6, heightMm: 152.4 },
  // Continuous roll: 62 mm wide; each tag is cut at 110 mm.
  '62mm': { key: '62mm', label: '62 mm continuous (cut at 110 mm)', widthMm: 62, heightMm: 110 },
};

export function labelSizeFor(settings: Pick<AppSettings, 'tag_label_size' | 'tag_custom_width_mm' | 'tag_custom_height_mm'>, key?: LabelSizeKey): LabelSize {
  const k = key ?? settings.tag_label_size ?? '100x150';
  if (k === 'custom') {
    const w = Number(settings.tag_custom_width_mm) || 100;
    const h = Number(settings.tag_custom_height_mm) || 150;
    return { key: 'custom', label: `Custom ${w} × ${h} mm`, widthMm: w, heightMm: h };
  }
  return LABEL_PRESETS[k];
}
