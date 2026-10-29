-- Cách xử lý hộp thoại câu hỏi/điều khoản khi tham gia nhóm: tự tick ô đồng ý nội quy và điền một câu trả lời mặc định do người dùng soạn.
-- Câu hỏi chọn đáp án (trắc nghiệm, danh sách chọn) không bao giờ được trả lời hộ.
ALTER TABLE group_join_settings ADD COLUMN agree_rules INTEGER NOT NULL DEFAULT 1 CHECK (agree_rules IN (0, 1));
ALTER TABLE group_join_settings ADD COLUMN default_answer TEXT NOT NULL DEFAULT '' CHECK (length(default_answer) <= 500);
