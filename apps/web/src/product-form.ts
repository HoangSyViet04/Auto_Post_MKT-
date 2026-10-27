import { generateProductCaption, type ProductDetail, type ProductFacts } from '#domain';

export interface ImageItem {
  id: string;
  /** Tên hiển thị trong phiên nhập; không được lưu hay gửi đi. */
  label: string;
}

export interface ProductFormState {
  name: string;
  condition: string;
  price: string;
  capacity: string;
  battery: string;
  warranty: string;
  location: string;
  images: ImageItem[];
}

export type FormField = 'name' | 'condition' | 'price' | 'images';
export type FormErrors = Partial<Record<FormField, string>>;

export const MAX_IMAGES = 100;

export function emptyForm(): ProductFormState {
  return { name: '', condition: '', price: '', capacity: '', battery: '', warranty: '', location: '', images: [] };
}

export function formFromDetail(detail: ProductDetail): ProductFormState {
  return {
    name: detail.name,
    condition: detail.condition,
    price: detail.priceVnd === null ? '' : String(detail.priceVnd),
    capacity: detail.capacityText ?? '',
    battery: detail.batteryText ?? '',
    warranty: detail.warrantyText ?? '',
    location: detail.locationText ?? '',
    images: detail.mediaIds.map((id, index) => ({ id, label: `Ảnh ${index + 1}` })),
  };
}

/** Trống là null (chưa có giá), không bao giờ là 0. Chấp nhận dấu chấm/phẩy/khoảng trắng phân tách nghìn. */
export function parsePrice(text: string): number | null | 'invalid' {
  const compact = text.replace(/[\s.,]/gu, '');
  if (!compact) return null;
  if (!/^\d+$/u.test(compact)) return 'invalid';
  const value = Number(compact);
  return Number.isSafeInteger(value) && value > 0 ? value : 'invalid';
}

const orNull = (text: string): string | null => text.trim() || null;

/** Chỉ tên, tình trạng và ít nhất một ảnh là bắt buộc. */
export function validateForm(form: ProductFormState): { errors: FormErrors; facts: ProductFacts | null } {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Nhập tên máy.';
  if (!form.condition.trim()) errors.condition = 'Nhập tình trạng máy.';
  if (form.images.length === 0) errors.images = 'Thêm ít nhất một ảnh.';
  const price = parsePrice(form.price);
  if (price === 'invalid') errors.price = 'Giá phải là số nguyên dương (ví dụ 9.500.000) hoặc để trống.';
  if (Object.keys(errors).length > 0 || price === 'invalid') return { errors, facts: null };
  return {
    errors,
    facts: {
      name: form.name.trim(),
      condition: form.condition.trim(),
      mediaIds: form.images.map((image) => image.id),
      priceVnd: price,
      capacityText: orNull(form.capacity),
      batteryText: orNull(form.battery),
      warrantyText: orNull(form.warranty),
      locationText: orNull(form.location),
    },
  };
}

/** Caption mẫu từ dữ kiện đang nhập; rỗng khi chưa đủ tên/tình trạng. Không tự thêm dữ kiện nào. */
export function previewCaption(form: ProductFormState): string {
  if (!form.name.trim() || !form.condition.trim()) return '';
  const price = parsePrice(form.price);
  return generateProductCaption({
    name: form.name,
    condition: form.condition,
    priceVnd: price === 'invalid' ? null : price,
    capacityText: form.capacity,
    batteryText: form.battery,
    warrantyText: form.warranty,
    locationText: form.location,
  });
}

/** Form khác với phiên bản máy đã lưu (so sánh cả thứ tự ảnh). */
export function isDirty(form: ProductFormState, detail: ProductDetail): boolean {
  const saved = formFromDetail(detail);
  const ids = (state: ProductFormState) => state.images.map((image) => image.id).join();
  return ids(form) !== ids(saved) || (['name', 'condition', 'price', 'capacity', 'battery', 'warranty', 'location'] as const)
    .some((field) => form[field].trim() !== saved[field].trim());
}

/** Đổi chỗ ảnh; vượt biên thì giữ nguyên. Không sửa mảng gốc. */
export function moveImage(images: readonly ImageItem[], index: number, delta: -1 | 1): ImageItem[] {
  const target = index + delta;
  const next = [...images];
  const moved = next[index];
  const other = next[target];
  if (!moved || !other) return next;
  next[index] = other;
  next[target] = moved;
  return next;
}
