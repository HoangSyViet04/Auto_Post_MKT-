import type { ApiError } from '#domain';

/** Thông báo lỗi tiếng Việt từ API (mã lỗi cố định, không chứa dữ liệu nhạy cảm). */
export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Không đọc được nội dung lỗi: dùng thông báo chung bên dưới.
  }
  return `Yêu cầu không thành công (HTTP ${response.status}).`;
}

export const networkMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Không kết nối được server cục bộ.';
