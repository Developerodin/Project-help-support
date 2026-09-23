import { can } from '@pms/shared';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';

export function useCanCreateTicket() {
  const { user } = useAuth();
  const { permissionContext } = usePermissionContext();
  const ctx = permissionContextForUi(permissionContext);
  return Boolean(user && !ctx?.loadFailed && can(user, 'tickets.create', ctx ?? undefined));
}
