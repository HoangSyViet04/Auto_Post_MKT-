-- Ghi nhận THỦ CÔNG khách hỏi và đơn hàng (P11.9). Ứng dụng không tự đọc tin nhắn, bình luận hay tương tác từ Facebook:
-- mọi dòng ở đây do người dùng tự nhập. Nguồn là bài đã đăng (job) hoặc để trống khi không rõ.
-- Không xóa hẳn: nhập nhầm thì đánh dấu hủy (voided_at), dòng cũ vẫn còn để đối chiếu.
CREATE TABLE sales_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  kind TEXT NOT NULL CHECK (kind IN ('inquiry','order')),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
  customer_label TEXT CHECK (customer_label IS NULL OR (length(trim(customer_label)) > 0 AND length(customer_label) <= 200)),
  note TEXT CHECK (note IS NULL OR (length(trim(note)) > 0 AND length(note) <= 2000)),
  amount_vnd INTEGER CHECK (amount_vnd IS NULL OR amount_vnd > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  voided_at INTEGER CHECK (voided_at IS NULL OR voided_at >= created_at),
  CHECK (kind = 'order' OR amount_vnd IS NULL)
) STRICT;
CREATE INDEX sales_events_product_time ON sales_events(product_id, occurred_at);
CREATE INDEX sales_events_job ON sales_events(job_id);
CREATE INDEX sales_events_time ON sales_events(occurred_at, id);

-- Bài nguồn phải thuộc đúng máy được ghi nhận.
CREATE TRIGGER sales_events_job_product BEFORE INSERT ON sales_events
WHEN NEW.job_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM publish_jobs j JOIN approvals a ON a.id = j.approval_id
  JOIN content_versions c ON c.id = a.content_version_id JOIN product_revisions r ON r.id = c.product_revision_id
  WHERE j.id = NEW.job_id AND r.product_id = NEW.product_id)
BEGIN SELECT RAISE(ABORT, 'sales event job must belong to the product'); END;

-- Chỉ được đánh dấu hủy một lần; mọi cột khác bất biến.
CREATE TRIGGER sales_events_only_void BEFORE UPDATE ON sales_events
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.product_id IS NOT OLD.product_id
  OR NEW.job_id IS NOT OLD.job_id OR NEW.occurred_at IS NOT OLD.occurred_at OR NEW.customer_label IS NOT OLD.customer_label
  OR NEW.note IS NOT OLD.note OR NEW.amount_vnd IS NOT OLD.amount_vnd OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'sales events can only be voided once'); END;
CREATE TRIGGER sales_events_no_delete BEFORE DELETE ON sales_events BEGIN SELECT RAISE(ABORT, 'sales events are never deleted'); END;
