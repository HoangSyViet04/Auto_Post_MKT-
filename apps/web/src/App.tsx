import { useEffect, useState } from 'react';
import { DEFAULT_PAGE_ID, findPage, findSection, NAV, type PageDef } from './nav.ts';
import { AccountsPage } from './AccountsPage.tsx';
import { ProductsPage } from './ProductsPage.tsx';
import { type HealthState, useHealth } from './useHealth.ts';

function readPageId(): string {
  const id = window.location.hash.replace(/^#\/?/, '');
  return findPage(id) ? id : DEFAULT_PAGE_ID;
}

export function App() {
  const [pageId, setPageId] = useState(readPageId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([findSection(readPageId())?.id ?? '']));
  const health = useHealth();

  useEffect(() => {
    const onHash = () => setPageId(readPageId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toggle = (sectionId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });

  const page = findPage(pageId) ?? findPage(DEFAULT_PAGE_ID);
  if (!page) throw new Error('Thiếu trang điều hướng mặc định');

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Auto Post MKT</div>
        <nav aria-label="Điều hướng chính">
          {NAV.map((section) =>
            section.pages.length === 1 ? (
              <a
                key={section.id}
                href={`#/${section.pages[0].id}`}
                className={`nav-item${pageId === section.pages[0].id ? ' active' : ''}`}
              >
                {section.title}
              </a>
            ) : (
              <div key={section.id} className="nav-group">
                <button
                  type="button"
                  className="nav-item nav-toggle"
                  aria-expanded={expanded.has(section.id)}
                  onClick={() => toggle(section.id)}
                >
                  {section.title}
                  <span className="chevron">{expanded.has(section.id) ? '▾' : '▸'}</span>
                </button>
                {expanded.has(section.id) &&
                  section.pages.map((sub) => (
                    <a key={sub.id} href={`#/${sub.id}`} className={`nav-item sub${pageId === sub.id ? ' active' : ''}`}>
                      {sub.title}
                    </a>
                  ))}
              </div>
            ),
          )}
        </nav>
        <HealthBadge health={health} />
      </aside>
      <main className="content">
        {health.kind === 'ok' && health.data.integrations === 'fake' && (
          <div className="sim-banner" role="status">
            Chế độ mô phỏng: dùng adapter giả, không gửi gì tới Facebook.
          </div>
        )}
        {page.id === 'products' ? <ProductsPage /> : page.id === 'accounts' ? <AccountsPage /> : <PlaceholderPage page={page} />}
      </main>
    </div>
  );
}

function PlaceholderPage({ page }: { page: PageDef }) {
  return (
    <section>
      <header className="page-header">
        <h1>{page.title}</h1>
        <span className="tag">Chưa triển khai · {page.phase}</span>
      </header>
      <p className="muted">{page.description}</p>
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
      Server: {health.data.env} · DB v{health.data.schemaVersion} ·{' '}
      {health.data.integrations === 'fake' ? 'mô phỏng' : 'tích hợp thật'}
    </div>
  );
}
