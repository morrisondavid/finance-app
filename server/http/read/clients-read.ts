import { allClients } from '../../domain/clients/index.js';
import { jsonReadOk, type JsonReadResult } from './types.js';

export function readClientsList(): JsonReadResult {
  return jsonReadOk({ clients: allClients() });
}
