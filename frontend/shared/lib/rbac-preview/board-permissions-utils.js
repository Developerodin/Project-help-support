import {
  BOARD_KEYS,
  BOARD_CAPABILITIES,
  BOARD_LABELS,
  BOARD_CAPABILITY_LABELS,
  MATRIX_ROLES,
  buildBoardRolePolicy,
  cloneBoardRolePolicy,
  boardPolicyToRecord,
  recordToBoardPolicy,
  diffBoardPolicies,
  policyHasCapability,
} from '@pms/shared';

export {
  BOARD_KEYS,
  BOARD_CAPABILITIES,
  BOARD_LABELS,
  BOARD_CAPABILITY_LABELS,
  MATRIX_ROLES,
  buildBoardRolePolicy,
  cloneBoardRolePolicy,
  boardPolicyToRecord,
  recordToBoardPolicy,
  diffBoardPolicies,
  policyHasCapability,
};

export function recordToBoardSnapshot(record) {
  return cloneBoardRolePolicy(recordToBoardPolicy(record || {}));
}

export function snapshotToBoardGrantsRecord(snapshot) {
  return boardPolicyToRecord(snapshot);
}

export function diffBoardSnapshots(fromSnapshot, toSnapshot) {
  return diffBoardPolicies(fromSnapshot, toSnapshot);
}

export function boardHasCapability(snapshot, role, board, capability) {
  return policyHasCapability(snapshot, role, board, capability);
}

export const BOARD_CAPABILITY_GROUPS = [
  {
    label: 'General',
    capabilities: ['operate', 'transition'],
  },
  {
    label: 'QA actions',
    capabilities: ['qa_approve', 'qa_reject'],
    boards: ['qa'],
  },
];
