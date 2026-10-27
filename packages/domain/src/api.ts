/** Kiểu request/response của API cục bộ, dùng chung giữa server và web. */
import type { IntegrationMode } from './channels.ts';

export type AppEnvName = 'development' | 'test' | 'production';

export interface HealthResponse {
  status: 'ok';
  env: AppEnvName;
  schemaVersion: number;
  /** fake: mô phỏng, UI phải hiển thị rõ. */
  integrations: IntegrationMode;
  startedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}

/** Dữ kiện nhập cho một phiên bản máy; trường tùy chọn thiếu là null, không phải 0. */
export interface ProductFacts {
  name: string;
  condition: string;
  mediaIds: string[];
  priceVnd: number | null;
  capacityText: string | null;
  batteryText: string | null;
  warrantyText: string | null;
  locationText: string | null;
}

export type ProductStatus = 'selling' | 'sold' | 'archived';

export interface ProductListItem {
  id: string;
  code: string;
  status: ProductStatus;
  name: string;
  condition: string;
  priceVnd: number | null;
  mediaCount: number;
  firstMediaId: string | null;
}

export interface ProductListResponse {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ContentVersionItem {
  id: string;
  revisionId: string;
  revisionNo: number;
  caption: string;
  source: 'template' | 'manual' | 'llm';
  destinationId: string | null;
  createdAt: number;
  mediaIds: string[];
}

export interface ProductDetail extends ProductFacts {
  id: string;
  code: string;
  status: ProductStatus;
  revisionId: string;
  revisionNo: number;
}
