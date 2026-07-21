/**
 * Routing_Rule_Set and Rule Management Interface (RuleManager).
 *
 * - Task 2: seed data structured from the demo category table (see `seedData.ts`).
 * - Task 3: RuleManager CRUD with validation and versioning (see `ruleManager.ts`).
 */
export {
  SEED_RULE_ENTRIES,
  SEED_EFFECTIVE_FROM,
  seedRuleEntries,
} from "./seedData.js";

export {
  RuleManager,
  isValidEmailFormat,
  type ValidationError,
  type Result,
} from "./ruleManager.js";
