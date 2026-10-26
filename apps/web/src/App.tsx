import { JOB_STATUSES } from '#domain';

/** Khung tạm — bốn mục điều hướng chính được dựng ở P00.5. */
export function App() {
  return (
    <main>
      <h1>Auto Post MKT</h1>
      <p>Khung ứng dụng đang dựng. Số trạng thái job: {JOB_STATUSES.length}</p>
    </main>
  );
}
