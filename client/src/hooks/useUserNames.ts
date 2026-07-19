// 全局用户下拉选项 + id→姓名映射（B8 收敛：多个面板不再各自维护同款映射；
// react-query 按 queryKey 去重，多处调用共享同一次请求与缓存）。
import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export function useUserNames() {
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const nameById = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u.name || u.username || `用户 #${u.id}`])),
    [users.data],
  );
  return { users: users.data ?? [], nameById, isLoading: users.isLoading };
}
