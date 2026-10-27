/** User-supplied facts only. Media validation belongs to the product/media flow. */
export interface ProductCaptionInput {
  name: string;
  condition: string;
  priceVnd?: number | null;
  storageGb?: number | null;
  batteryPercent?: number | null;
  warrantyText?: string | null;
  /** Dữ kiện dạng chữ do người dùng nhập; chỉ dùng khi không có số tương ứng. */
  capacityText?: string | null;
  batteryText?: string | null;
  locationText?: string | null;
}

type CaptionField = keyof ProductCaptionInput | 'product';

export class CaptionValidationError extends Error {
  readonly field: CaptionField;

  constructor(field: CaptionField) {
    super(`Thông tin tạo caption không hợp lệ: ${field}.`);
    this.name = 'CaptionValidationError';
    this.field = field;
  }
}

function requiredText(value: unknown, field: CaptionField): string {
  if (typeof value !== 'string' || !value.trim()) throw new CaptionValidationError(field);
  return value.trim();
}

/** No LLM, default facts, persistence or network; callers retain the original input. */
export function generateProductCaption(input: ProductCaptionInput): string {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new CaptionValidationError('product');
  const name = requiredText(input.name, 'name').replace(/\s+/gu, ' ');
  const condition = requiredText(input.condition, 'condition');
  const lines = [name, `Tình trạng: ${condition}`];

  if (input.priceVnd !== null && input.priceVnd !== undefined) {
    if (!Number.isSafeInteger(input.priceVnd) || input.priceVnd <= 0) throw new CaptionValidationError('priceVnd');
    lines.push(`Giá: ${new Intl.NumberFormat('vi-VN').format(input.priceVnd)} đ`);
  }
  if (input.storageGb !== null && input.storageGb !== undefined) {
    if (!Number.isSafeInteger(input.storageGb) || input.storageGb <= 0) throw new CaptionValidationError('storageGb');
    lines.push(`Dung lượng: ${input.storageGb} GB`);
  }
  if (input.batteryPercent !== null && input.batteryPercent !== undefined) {
    if (typeof input.batteryPercent !== 'number' || !Number.isFinite(input.batteryPercent)
      || input.batteryPercent < 0 || input.batteryPercent > 100) throw new CaptionValidationError('batteryPercent');
    lines.push(`Pin: ${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 20 }).format(input.batteryPercent)}%`);
  }
  const extra = (value: unknown, field: CaptionField, label: string, skip: boolean) => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'string') throw new CaptionValidationError(field);
    const trimmed = value.trim();
    if (trimmed && !skip) lines.push(`${label}: ${trimmed}`);
  };
  extra(input.capacityText, 'capacityText', 'Dung lượng', input.storageGb != null);
  extra(input.batteryText, 'batteryText', 'Pin', input.batteryPercent != null);
  if (input.warrantyText !== null && input.warrantyText !== undefined) {
    if (typeof input.warrantyText !== 'string') throw new CaptionValidationError('warrantyText');
    const warranty = input.warrantyText.trim();
    if (warranty) lines.push(`Bảo hành: ${warranty}`);
  }
  extra(input.locationText, 'locationText', 'Khu vực', false);
  return lines.join('\n');
}
