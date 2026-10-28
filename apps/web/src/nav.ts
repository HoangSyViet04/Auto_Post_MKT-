/** Điều hướng chính theo README mục 3.3: bốn mục, hai mục có trang con. */

export interface PageDef {
  id: string;
  title: string;
  description: string;
  /** Phần trong plan.md sẽ triển khai trang này. */
  phase: string;
  /** Thao tác dự kiến — hiển thị ở trạng thái chưa triển khai. */
  actions: string[];
}

export interface NavSection {
  id: string;
  title: string;
  pages: [PageDef, ...PageDef[]];
}

export const NAV: NavSection[] = [
  {
    id: 'accounts',
    title: 'Quản lý tài khoản',
    pages: [
      {
        id: 'accounts',
        title: 'Quản lý tài khoản',
        description: 'Tối đa hai tài khoản Facebook: nhãn, danh tính, trạng thái phiên, proxy và tác vụ hiện tại.',
        phase: 'P03',
        actions: ['Thêm tài khoản', 'Mở trình duyệt để đăng nhập', 'Kiểm tra phiên', 'Tạm dừng', 'Gỡ liên kết'],
      },
    ],
  },
  {
    id: 'proxies',
    title: 'Quản lý proxy',
    pages: [
      {
        id: 'proxies',
        title: 'Quản lý proxy',
        description: 'Cấu hình kết nối tùy chọn cho từng tài khoản. Proxy không bảo đảm tránh checkpoint hay khóa tài khoản.',
        phase: 'P04',
        actions: ['Thêm proxy', 'Kiểm tra kết nối', 'Gán cho tài khoản', 'Bỏ gán'],
      },
    ],
  },
  {
    id: 'posting',
    title: 'Chức năng đăng bài',
    pages: [
      {
        id: 'products',
        title: 'Quản lý máy',
        description: 'Nhập máy với ảnh, tên và tình trạng; xem trước caption mẫu.',
        phase: 'P05',
        actions: [],
      },
      {
        id: 'queue',
        title: 'Hàng chờ đăng',
        description: 'Các bài đã duyệt và xếp lịch: trạng thái từng đích, tạm dừng, hủy, chạy ngay.',
        phase: 'P07',
        actions: [],
      },
      {
        id: 'post-group',
        title: 'Đăng bài viết nhóm',
        description: 'Chọn tài khoản và group, cấu hình nội dung, ảnh, lịch; theo dõi kết quả từng group.',
        phase: 'P05–P10',
        actions: ['Chọn máy', 'Xem trước', 'Bắt đầu', 'Tạm dừng', 'Dừng'],
      },
      {
        id: 'post-profile',
        title: 'Đăng bài viết cá nhân',
        description: 'Đăng lên trang cá nhân của một hoặc cả hai tài khoản, xác nhận đúng TCN đích.',
        phase: 'P05–P10',
        actions: ['Chọn máy', 'Xem trước theo tài khoản', 'Đăng ngay', 'Đặt lịch'],
      },
      {
        id: 'sales',
        title: 'Khách hỏi và đơn hàng',
        description: 'Tự ghi nhận khách hỏi và đơn hàng từ bài đã đăng; ứng dụng không tự đọc tương tác từ Facebook.',
        phase: 'P11',
        actions: [],
      },
      {
        id: 'post-page',
        title: 'Đăng bài fanpage',
        description: 'Đăng bài (chữ + ảnh) lên một Page đã kết nối qua Graph API; bài công khai trên fanpage.',
        phase: 'P09',
        actions: [],
      },
    ],
  },
  {
    id: 'scan',
    title: 'Quét nhóm',
    pages: [
      {
        id: 'scan-joined',
        title: 'Nhóm đã tham gia',
        description: 'Đọc danh sách group mà từng tài khoản đang tham gia, trong phạm vi giao diện cho phép.',
        phase: 'P06',
        actions: ['Chọn tài khoản', 'Bắt đầu quét', 'Dừng', 'Lưu nhóm đã chọn'],
      },
      {
        id: 'scan-keyword',
        title: 'Tìm nhóm theo từ khóa',
        description: 'Tìm group theo từ khóa. Tìm thấy không đồng nghĩa đã tham gia hoặc được phép đăng.',
        phase: 'P06',
        actions: ['Nhập từ khóa', 'Bắt đầu tìm', 'Dừng', 'Chuyển sang đăng nhóm'],
      },
    ],
  },
];

export const ALL_PAGES = NAV.flatMap((section) => section.pages);
export const DEFAULT_PAGE_ID = 'accounts';

export function findPage(id: string): PageDef | undefined {
  return ALL_PAGES.find((page) => page.id === id);
}

export function findSection(pageId: string): NavSection | undefined {
  return NAV.find((section) => section.pages.some((page) => page.id === pageId));
}
