-- Ghi nhận của người dùng cho đích (P06): mức ưu tiên và ghi chú riêng. Không chạm vào cột danh tính bất biến.
ALTER TABLE destinations ADD COLUMN curation TEXT NOT NULL DEFAULT 'normal' CHECK (curation IN ('normal','preferred','unsuitable'));
ALTER TABLE destinations ADD COLUMN user_note TEXT;
