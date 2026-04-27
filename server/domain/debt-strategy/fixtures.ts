import { loadPlansData } from './data.js';
import {
  buildPlanRegistryFromData,
  type PlanRegistry,
} from './registry.js';
import type { Plan } from './schema.js';

export function makeTestPlanRegistry(override?: readonly Plan[]): PlanRegistry {
  return buildPlanRegistryFromData(override ?? loadPlansData());
}
