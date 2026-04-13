import type { Logger } from '../logger.js';

export const MAX_SONNET_ESCALATIONS_PER_BATCH = 3;

export interface CallBudget {
  count: number;
  readonly max: number;
  escalationCount: number;
  readonly maxEscalations: number;
  escalationLimitLogged: boolean;
}

export function budgetExhausted(budget: CallBudget, log: Logger): boolean {
  budget.count++;
  if (budget.count > budget.max) {
    log.warn({ count: budget.count, max: budget.max }, 'Batch LLM call budget exhausted');
    return true;
  }
  return false;
}

export function escalationBudgetExhausted(budget: CallBudget, log: Logger): boolean {
  if (budget.escalationCount < budget.maxEscalations) {
    return false;
  }

  if (!budget.escalationLimitLogged) {
    budget.escalationLimitLogged = true;
    log.warn({ count: budget.escalationCount, max: budget.maxEscalations }, 'Batch Sonnet escalation cap reached');
  }

  return true;
}
