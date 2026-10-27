/** Cảnh báo caption giống nhau: so khớp từ đơn giản, không dùng AI/ngữ nghĩa (plan P05.6). */

function tokens(text: string): Set<string> {
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLowerCase();
  return new Set(plain.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** 0..1: tỉ lệ từ chung (Jaccard) sau khi bỏ dấu, hoa/thường và dấu câu; hai chuỗi không có từ nào là 0. */
export function captionSimilarity(a: string, b: string): number {
  const first = tokens(a);
  const second = tokens(b);
  if (first.size === 0 || second.size === 0) return 0;
  let common = 0;
  for (const word of first) if (second.has(word)) common += 1;
  return common / (first.size + second.size - common);
}

export const SIMILAR_CAPTION_THRESHOLD = 0.8;

/** Các bản đã có giống `caption` từ ngưỡng trở lên, giống nhất trước. Chỉ cảnh báo, không chặn. */
export function findSimilarCaptions<T extends { caption: string }>(
  caption: string,
  existing: readonly T[],
  threshold = SIMILAR_CAPTION_THRESHOLD,
): Array<{ item: T; score: number }> {
  return existing
    .map((item) => ({ item, score: captionSimilarity(caption, item.caption) }))
    .filter((match) => match.score >= threshold)
    .sort((x, y) => y.score - x.score);
}
