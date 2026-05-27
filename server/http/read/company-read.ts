import { CompaniesListResponseSchema } from '../../../shared/api-contracts.js';
import { allCompanies } from '../../domain/company/index.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export function readCompanyList(): JsonReadResult {
  try {
    return jsonReadOk(CompaniesListResponseSchema.parse({ companies: allCompanies() }));
  } catch (error) {
    console.error('[Company read] GET error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonReadFail(500, { error: `Failed to list companies: ${message}` });
  }
}
