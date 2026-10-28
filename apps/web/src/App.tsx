import { useEffect, useState } from 'react';
import { DEFAULT_PAGE_ID, findPage, type PageDef } from './nav.ts';
import { AccountsPage } from './AccountsPage.tsx';
import { GroupsPage } from './GroupsPage.tsx';
import { JobsPage } from './JobsPage.tsx';
import { PostGroupPage } from './PostGroupPage.tsx';
import { PostPagePage } from './PostPagePage.tsx';
import { PostProfilePage } from './PostProfilePage.tsx';
import { clearHandoff, getHandoff } from './handoff.ts';
import { ProductsPage } from './ProductsPage.tsx';
import { SalesPage } from './SalesPage.tsx';
import { type HealthState, useHealth } from './useHealth.ts';
import { Icon, type IconName } from './Icon.tsx';

const MAIN_NAV: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'accounts', label: 'Quản lý tài khoản', icon: 'accounts' },
  { id: 'products', label: 'Quản lý máy', icon: 'phone' },
  { id: 'scan-joined', label: 'Nhóm đã tham gia', icon: 'groups' },
  { id: 'post-group', label: 'Đăng nhóm', icon: 'send' },
  { id: 'post-profile', label: 'Đăng trang cá nhân', icon: 'profile' },
  { id: 'post-page', label: 'Đăng fanpage', icon: 'send' },
  { id: 'queue', label: 'Hàng chờ & lịch sử', icon: 'history' },
  { id: 'sales', label: 'Khách hỏi & đơn hàng', icon: 'sales' },
];

function readPageId(): string {
  const id = window.location.hash.replace(/^#\/?/, '');
  return findPage(id) ? id : DEFAULT_PAGE_ID;
}

export function App() {
  const [pageId, setPageId] = useState(readPageId);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const health = useHealth();

  useEffect(() => {
    const onHash = () => { setPageId(readPageId()); setMobileNavOpen(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const page = findPage(pageId) ?? findPage(DEFAULT_PAGE_ID);
  if (!page) throw new Error('Thiếu trang điều hướng mặc định');

  return (
    <div className="layout">
      <aside className={`sidebar${mobileNavOpen ? ' is-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Icon name="phone" /></span><div>Auto Post MKT<small>Cửa hàng điện thoại</small></div>
          <button type="button" className="mobile-nav-toggle" aria-label="Mở hoặc đóng menu" aria-expanded={mobileNavOpen} aria-controls="app-navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}><Icon name="menu" /></button>
        </div>
        <nav id="app-navigation" aria-label="Điều hướng chính">
          <div className="nav-caption">KHÔNG GIAN LÀM VIỆC</div>
          {MAIN_NAV.map((item) => <a key={item.id} href={`#/${item.id}`} aria-current={pageId === item.id ? 'page' : undefined} className={`nav-item${pageId === item.id ? ' active' : ''}`}><Icon name={item.icon} /><span>{item.label}</span></a>)}
          <div className="nav-caption nav-divider">TÍNH NĂNG MỞ RỘNG</div>
          {([{ id: 'scan-keyword', label: 'Tìm nhóm từ khóa', icon: 'search' }, { id: 'proxies', label: 'Quản lý proxy', icon: 'sliders' }] as const).map((item) =>
            <a key={item.id} href={`#/${item.id}`} aria-current={pageId === item.id ? 'page' : undefined} className={`nav-item secondary${pageId === item.id ? ' active' : ''}`}><Icon name={item.icon} /><span>{item.label}</span><small>Chưa có</small></a>)}
        </nav>
        <div className="sidebar-footer"><HealthBadge health={health} /><span className="local-storage-note">Dữ liệu lưu trên máy của bạn</span></div>
      </aside>
      <main className="content">
        <div className="app-topbar"><span>Cửa hàng điện thoại <Icon name="chevron" /> <strong>{MAIN_NAV.find((item) => item.id === pageId)?.label ?? page.title}</strong></span>
          {health.kind === 'ok' && <span className={`mode-pill ${health.data.integrations === 'live' ? 'is-live' : ''}`}>{health.data.integrations === 'live' ? 'ĐĂNG THẬT' : 'MÔ PHỎNG'}</span>}
        </div>
        {health.kind === 'ok' && health.data.integrations === 'live' && (
          <div className="live-banner" role="status">
            Chế độ THẬT: bài đã duyệt sẽ được đăng lên Facebook bằng trình duyệt. Kiểm tra kỹ tài khoản, đích và nội dung trước khi xếp lịch.
          </div>
        )}
        {health.kind === 'ok' && health.data.integrations === 'fake' && (
          <div className="sim-banner" role="status">
            Chế độ mô phỏng · Bạn có thể thử thao tác, không có bài nào được gửi tới Facebook.
          </div>
        )}
        <div className={page.id === 'post-group' ? 'app-page' : 'app-page data-page'}>{page.id === 'products' ? <ProductsPage />
          : page.id === 'accounts' ? <AccountsPage />
          : page.id === 'scan-joined' ? <GroupsPage />
          : page.id === 'queue' ? <JobsPage />
          : page.id === 'post-group' ? <PostGroupPage />
          : page.id === 'post-profile' ? <PostProfilePage />
          : page.id === 'post-page' ? <PostPagePage />
          : page.id === 'sales' ? <SalesPage />
          : <PlaceholderPage page={page} />}</div>
      </main>
    </div>
  );
}

function PlaceholderPage({ page }: { page: PageDef }) {
  const handoff = page.id === 'post-group' ? getHandoff() : null;
  return (
    <section>
      <header className="page-header">
        <h1>{page.title}</h1>
        <span className="tag">Chưa triển khai · {page.phase}</span>
      </header>
      <p className="muted">{page.description}</p>
      {handoff && (
        <div className="notice" role="status">
          Đã nhận {handoff.groups.length} nhóm cho tài khoản <strong>{handoff.accountLabel}</strong>: {handoff.groups.map((g) => g.name).join(', ')}.
          Chưa thể tạo hàng chờ hoặc đăng — phần này thuộc P10. <button type="button" onClick={() => { clearHandoff(); window.location.reload(); }}>Bỏ chọn</button>
        </div>
      )}
      <div className="actions">
        {page.actions.map((action) => (
          <button key={action} type="button" disabled title="Chưa triển khai">
            {action}
          </button>
        ))}
      </div>
      <p className="notice">Trang này mới là khung. Không có thao tác nào gửi tới Facebook.</p>
    </section>
  );
}

function HealthBadge({ health }: { health: HealthState }) {
  if (health.kind === 'loading') return <div className="health">Đang kiểm tra server…</div>;
  if (health.kind === 'error') {
    return <div className="health error">Mất kết nối server cục bộ ({health.message})</div>;
  }
  return (
    <div className="health ok">
      <span className="status-dot" /> Ứng dụng sẵn sàng
    </div>
  );
}
