import type { Scenario } from '../types';
import { ATTACK_SCENARIOS } from './attacks';
import { NORMAL_SCENARIOS } from './normal';

/** Every scenario, attacks first, in scorecard order. */
export const SCENARIOS: readonly Scenario[] = [...ATTACK_SCENARIOS, ...NORMAL_SCENARIOS];
