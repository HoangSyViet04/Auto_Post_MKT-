import type { GroupItem } from '#domain';

/** Select within the visible filter; stable priority/name/id order, never borrows another account's permission. */
export function selectGroupCount(groups: readonly GroupItem[], accountId: string, count: number): { selected: string[]; available: number } {
  if (!accountId || !Number.isInteger(count) || count < 1 || count > 100) throw new Error('Nhập số nhóm từ 1 đến 100.');
  const eligible = [...new Map(groups.filter((group) => !group.archived && group.curation !== 'unsuitable'
    && group.accounts.some((relation) => relation.accountId === accountId && relation.eligible)).map((group) => [group.id, group])).values()]
    .sort((a, b) => Number(b.curation === 'preferred') - Number(a.curation === 'preferred')
      || (a.name ?? a.externalId ?? '').localeCompare(b.name ?? b.externalId ?? '', 'vi') || a.id.localeCompare(b.id));
  return { selected: eligible.slice(0, count).map((group) => group.id), available: eligible.length };
}
