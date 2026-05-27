import { ApiVersionResponseSchema } from '../../../shared/api-contracts.js';
import { buildApiVersionPayload } from '../../runtime-version.js';
import { jsonReadOk, type JsonReadResult } from './types.js';

export function readApiVersion(): JsonReadResult {
  return jsonReadOk(ApiVersionResponseSchema.parse(buildApiVersionPayload()));
}
