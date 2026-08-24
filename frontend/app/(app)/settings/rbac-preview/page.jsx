import { redirect } from 'next/navigation';

// ponytail: hub removed — two screens only; land on role baseline policy.
export default function RbacPreviewRootPage() {
  redirect('/settings/rbac-preview/matrix');
}
