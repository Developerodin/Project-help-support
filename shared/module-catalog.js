/**
 * Web app module + page taxonomy for ticket location fields.
 * Ported from Dharwin Help & Support dev-ticket-modules.ts (sidebar nav catalog).
 * Keep in sync when Dharwin navigation changes.
 */

/** @typedef {{ label: string, path: string, screens?: ModuleScreen[] }} ModulePage */
/** @typedef {{ name: string, type?: string, route?: string, status?: string, documentation?: string }} ModuleScreen */
/** @typedef {{ label: string, pages: ModulePage[] }} ModuleGroup */

/** @type {ModuleGroup[]} */
export const WEB_MODULE_TAXONOMY = Object.freeze([
  {
    label: 'MAIN',
    pages: [{ label: 'Dashboard', path: '/dashboard' }],
  },
  {
    label: 'ATS',
    pages: [
      { label: 'Jobs', path: '/ats/jobs' },
      { label: 'Applications', path: '/ats/applications' },
      { label: 'External Jobs', path: '/ats/external-jobs' },
      { label: 'Employees', path: '/ats/employees' },
      { label: 'Referral leads', path: '/ats/referral-leads' },
      { label: 'Share candidate form', path: '/ats/share-candidate-form' },
      { label: 'Browse Jobs', path: '/ats/browse-jobs' },
      { label: 'My Applications', path: '/ats/my-applications' },
      { label: 'Courses', path: '/courses' },
      { label: 'Recruiters', path: '/ats/recruiters' },
      { label: 'Interviews', path: '/ats/interviews' },
      { label: 'Offers & Placement', path: '/ats/offers-placement' },
      { label: 'Pre-boarding', path: '/ats/pre-boarding' },
      { label: 'Onboarding', path: '/ats/onboarding' },
      { label: 'Analytics', path: '/ats/analytics' },
    ],
  },
  {
    label: 'ORGANIZATION',
    pages: [
      { label: 'Org Chart', path: '/organization/chart' },
      { label: 'Structure', path: '/organization/structure' },
      { label: 'Departments', path: '/organization/departments' },
      { label: 'Directory', path: '/organization/directory' },
      { label: 'Scenarios', path: '/organization/scenarios' },
    ],
  },
  {
    label: 'Communication',
    pages: [
      { label: 'Email', path: '/communication/email' },
      { label: 'Chats', path: '/communication/chats' },
      { label: 'Meetings', path: '/communication/meetings' },
      { label: 'Dialer', path: '/communication/dialer' },
      { label: 'Call Records', path: '/communication/calling' },
      { label: 'Recordings', path: '/communication/recordings' },
      { label: 'Files Storage', path: '/communication/filemanager' },
    ],
  },
  {
    label: 'Training Management',
    pages: [
      { label: 'Categories & Positions', path: '/training/curriculum/setup?tab=categories' },
      { label: 'Training Modules', path: '/training/curriculum/modules' },
      { label: 'Attendance Tracking', path: '/training/attendance' },
      { label: 'Mentors', path: '/training/mentors' },
      { label: 'Students', path: '/training/students' },
      { label: 'Evaluation', path: '/training/evaluation' },
      { label: 'Analytics', path: '/training/analytics' },
    ],
  },
  {
    label: 'Project Management',
    pages: [
      { label: 'Projects', path: '/apps/projects/project-list' },
      { label: 'My Projects', path: '/apps/projects/my-projects' },
      { label: 'My Tasks', path: '/task/my-tasks' },
      { label: 'Task Board', path: '/task/kanban-board' },
      { label: 'Teams', path: '/project-management/teams' },
      { label: 'Analytics', path: '/project-management/analytics' },
    ],
  },
  {
    label: 'Logs',
    pages: [
      { label: 'Logs Activity', path: '/logs/logs-activity' },
      { label: 'Platform audit', path: '/logs/logs-activity/platform' },
    ],
  },
  {
    label: 'Help & Support',
    pages: [
      { label: 'Help & Support (Tickets)', path: '/dev-tickets' },
      { label: 'Board', path: '/dev-tickets/board' },
      { label: 'Analytics', path: '/dev-tickets/analytics' },
      { label: 'Support Tickets', path: '/support-tickets' },
    ],
  },
  {
    label: 'Settings',
    pages: [
      { label: 'User Roles', path: '/settings/roles' },
      { label: 'Users', path: '/settings/users' },
      { label: 'Personal Information', path: '/settings/personal-information' },
      { label: 'Agents', path: '/settings/agents' },
      { label: 'Company Email', path: '/settings/company-email' },
      { label: 'Candidate SOP', path: '/settings/candidates/sop' },
      { label: 'Offboarding SOP', path: '/settings/offboarding/sop' },
      { label: 'Email Templates', path: '/settings/email-templates' },
      { label: 'Email Templates (Admin)', path: '/settings/email-templates-admin' },
      { label: 'Job Templates', path: '/settings/job-templates' },
      { label: 'Attendance', path: '/settings/attendance' },
      { label: 'Week Off', path: '/settings/attendance/week-off' },
      { label: 'Holidays', path: '/settings/attendance/holidays' },
      { label: 'Holiday Groups', path: '/settings/attendance/holiday-groups' },
      { label: 'Assign Holidays', path: '/settings/attendance/assign-holidays' },
      { label: 'Candidate Groups', path: '/settings/attendance/candidate-groups' },
      { label: 'Manage Shifts', path: '/settings/attendance/manage-shifts' },
      { label: 'Assign Shift', path: '/settings/attendance/assign-shift' },
      { label: 'Assign Leave', path: '/settings/attendance/assign-leave' },
      { label: 'Leave Requests', path: '/settings/attendance/leave-requests' },
      { label: 'Backdated Attendance', path: '/settings/attendance/backdated-attendance-requests' },
      { label: 'My Profile', path: '/ats/my-profile' },
    ],
  },
]);

export const WEB_MODULE_LABELS = Object.freeze(WEB_MODULE_TAXONOMY.map((g) => g.label));

/** @param {string} moduleLabel */
export function getPagesForModule(moduleLabel) {
  const group = WEB_MODULE_TAXONOMY.find((g) => g.label === moduleLabel);
  return group?.pages ?? [];
}

/** Resolve project taxonomy, falling back to the WEB catalog when unset. */
export function resolveProjectModules(project) {
  if (project?.modules?.length) return project.modules;
  if (project?.key === 'WEB') return WEB_MODULE_TAXONOMY;
  return [];
}
