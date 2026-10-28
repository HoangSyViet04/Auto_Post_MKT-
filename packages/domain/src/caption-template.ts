import type { ProductFacts } from './api.ts';

/** Chỗ trống người dùng được chèn vào mẫu caption; mỗi chỗ trống chỉ lấy đúng dữ kiện đã nhập cho máy. */
export const CAPTION_PLACEHOLDERS = {
  ten: 'Tên máy',
  tinh_trang: 'Tình trạng',
  gia: 'Giá',
  dung_luong: 'Dung lượng',
  pin: 'Pin',
  bao_hanh: 'Bảo hành',
  khu_vuc: 'Khu vực',
} as const;
export type CaptionPlaceholder = keyof typeof CAPTION_PLACEHOLDERS;

const TOKEN = /\{([^{}\s]{1,40})\}/gu;
const isKnown = (name: string): name is CaptionPlaceholder => Object.hasOwn(CAPTION_PLACEHOLDERS, name);

/** Chỗ trống không có trong danh sách (gõ sai). Rỗng nghĩa là mẫu hợp lệ. */
export function captionTemplateProblems(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(TOKEN)) if (!isKnown(match[1] as string)) unknown.add(`{${match[1]}}`);
  const problems = [...unknown].map((name) => `Chỗ trống không hợp lệ: ${name}.`);
  if (template.trim() === '') problems.push('Mẫu caption đang trống.');
  return problems;
}

function placeholderValue(name: CaptionPlaceholder, facts: Pick<ProductFacts, 'name' | 'condition' | 'priceVnd' | 'capacityText' | 'batteryText' | 'warrantyText' | 'locationText'>): string {
  switch (name) {
    case 'ten': return facts.name;
    case 'tinh_trang': return facts.condition;
    case 'gia': return facts.priceVnd === null ? '' : `${new Intl.NumberFormat('vi-VN').format(facts.priceVnd)} đ`;
    case 'dung_luong': return facts.capacityText ?? '';
    case 'pin': return facts.batteryText ?? '';
    case 'bao_hanh': return facts.warrantyText ?? '';
    case 'khu_vuc': return facts.locationText ?? '';
  }
}

/**
 * Điền mẫu bằng dữ kiện của máy. Không bịa: dòng nào có chỗ trống mà máy chưa có dữ kiện đó thì BỎ CẢ DÒNG
 * (ví dụ "Giá: {gia}" biến mất khi chưa nhập giá). Dòng không có chỗ trống (lời chào, cách liên hệ…) giữ nguyên.
 * Chỗ trống lạ cũng làm dòng bị bỏ thay vì in ra "{...}" lên Facebook.
 */
export function renderCaptionTemplate(template: string, facts: Parameters<typeof placeholderValue>[1]): string {
  const lines: string[] = [];
  for (const raw of template.split(/\r?\n/u)) {
    let missing = false;
    const line = raw.replace(TOKEN, (_whole, name: string) => {
      const value = isKnown(name) ? placeholderValue(name, facts).trim() : '';
      if (value === '') missing = true;
      return value;
    });
    if (missing) continue;
    // Không để hai dòng trống liên tiếp (do bỏ dòng ở giữa) và không bắt đầu bằng dòng trống.
    if (line.trim() === '' && (lines.length === 0 || lines[lines.length - 1]?.trim() === '')) continue;
    lines.push(line.trimEnd());
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  return lines.join('\n');
}
