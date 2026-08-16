/**
 * Library surface. Importing `@chrischall/pickuppatrol-mcp` gives the typed
 * client and the plan-building rules without starting an MCP server, so
 * another tool can reuse the capture rather than re-deriving it.
 */
export { PickUpPatrolClient, type ClientOptions } from './client.js';
export {
  PickUpPatrolAuth,
  describeResponseStatus,
  collectCookieHeader,
  BASE_URL,
  BASE_PATH,
  type AuthOptions,
  type PupSession,
  type FetchLike,
} from './auth.js';
export {
  buildPlanUpdates,
  applyDefaultPlans,
  clearDefaultPlans,
  assertTransportationAllowed,
  normalizeNote,
  normalizeEarlyDismissal,
  normalizeCarNumber,
  DEFAULT_PLAN_LABEL,
  type PlanInput,
  type DefaultPlanInput,
} from './plans.js';
export { dayIdToName, nameToDayId, dateToDayId, WEEKDAY_NAMES, type WeekdayName } from './dates.js';
export { VERSION } from './version.js';
export type * from './types.js';
