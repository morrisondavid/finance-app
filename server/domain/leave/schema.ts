/**
 * Leave domain — schema re-exports.
 *
 * The canonical Zod schemas live in `shared/api-contracts.ts` so
 * frontend code (the Book Leave modal, per-row edit forms) can share
 * them with the backend without pulling in server-only modules. This
 * file is the server-side entry point that re-exports the public
 * surface, plus server-only types that never leave the backend.
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
} from '../../../shared/api-contracts.js';
