/**
 * Leave domain — public barrel.
 */

export {
  LeaveIdSchema,
  LeaveTypeSchema,
  LeaveRowSchema,
  LeaveRequestSchema,
  LeaveListResponseSchema,
  LeaveCreateResponseSchema,
  type LeaveId,
  type LeaveType,
  type LeaveRow,
  type LeaveRequest,
  type LeaveListResponse,
  type LeaveCreateResponse,
} from './schema.js';

export {
  buildLeaveRegistry,
  buildLeaveRegistryFromData,
  getLeaveRegistry,
  invalidateLeaveRegistry,
  __resetLeaveRegistryForTests,
  setLeaveRegistryWorkingDaysDirForTests,
  type LeaveRegistry,
  type BuildLeaveRegistryInput,
} from './registry.js';

export {
  allLeave,
  findLeaveById,
  leaveForContract,
  leaveInWindow,
  upsertLeaveRows,
  deleteLeaveRow,
  setLeaveWorkingDaysDirForTests,
  type UpsertLeaveRowsInput,
  type DeleteLeaveRowInput,
} from './queries.js';

export {
  makeTestLeaveRegistry,
  type LeaveRegistryFixtureInput,
} from './fixtures.js';

export {
  LEAVE_CSV_FILENAME,
  LEAVE_CSV_HEADERS,
  composeLeaveId,
  getLeaveCsvPath,
  parseLeaveRow,
  readLeaveCsvFile,
  serializeLeaveRow,
  serializeLeaveCsv,
  writeLeaveCsvFile,
} from './csv-io.js';
