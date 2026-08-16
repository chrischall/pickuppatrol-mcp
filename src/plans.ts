import { McpToolError } from '@chrischall/mcp-utils';
import { dateToDayId } from './dates.js';
import type { DefaultPlan, PlanUpdate, Student, Transportation } from './types.js';

/**
 * Display text the SPA sends when a date is reverted to the student's default
 * plan. `TransportationId: null` is what the server acts on; the name is
 * cosmetic, but it is sent, so we send it too.
 */
export const DEFAULT_PLAN_LABEL = 'Default plan';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^\d{2}:\d{2}(:\d{2})?$/;

export interface PlanInput {
  student: Student;
  dates: string[];
  /** `null` reverts each date to the student's weekly default. */
  transportation: Transportation | null;
  note?: string | undefined;
  earlyDismissalTime?: string | undefined;
  carNumber?: string | undefined;
}

/**
 * Turn a plan request into the exact `UpdatePlans` array the SPA would send,
 * enforcing the same rules it enforces client-side. Every rejection is a
 * `McpToolError` with a hint, because these are all things the caller can fix
 * by reading `pup_list_transportations` first.
 */
export function buildPlanUpdates(input: PlanInput): PlanUpdate[] {
  const { student, dates, transportation } = input;

  if (dates.length === 0) {
    throw new McpToolError('No dates given', { hint: 'Pass at least one YYYY-MM-DD date.' });
  }
  for (const date of dates) {
    // Shape AND reality: `2026-13-45` matches the pattern but is not a date,
    // and sending it would put an impossible plan in front of the school.
    if (!ISO_DATE.test(date) || dateToDayId(date) === null) {
      throw new McpToolError(`"${date}" is not a YYYY-MM-DD date`, {
        hint: 'Plan dates are plain calendar dates, e.g. 2026-08-17.',
      });
    }
  }
  const duplicate = dates.find((date, i) => dates.indexOf(date) !== i);
  if (duplicate !== undefined) {
    throw new McpToolError(`Date ${duplicate} is listed more than once`, {
      hint: 'Each date may appear only once per call.',
    });
  }

  // Revert-to-default: a null transportation, no note, nothing else.
  if (transportation === null) {
    return dates.map((date) => ({
      StudentId: student.StudentId,
      SchoolId: student.SchoolId,
      PlanDate: date,
      TransportationId: null,
      TransportationName: DEFAULT_PLAN_LABEL,
      Note: null,
    }));
  }

  assertTransportationAllowed(student, transportation);
  const note = normalizeNote(transportation, input.note);
  const earlyDismissalTime = normalizeEarlyDismissal(transportation, input.earlyDismissalTime);
  const carNumber = normalizeCarNumber(transportation, input.carNumber);

  return dates.map((date) => ({
    StudentId: student.StudentId,
    SchoolId: student.SchoolId,
    PlanDate: date,
    TransportationId: transportation.TransportationId,
    TransportationName: transportation.Name,
    Note: note,
    // Omit rather than send null: the SPA leaves both keys off when they do
    // not apply, and an undocumented API is not the place to test whether an
    // explicit null means "clear" or "invalid".
    ...(earlyDismissalTime !== undefined ? { EarlyDismissalTime: earlyDismissalTime } : {}),
    ...(carNumber !== undefined ? { CarNumber: carNumber } : {}),
  }));
}

/**
 * A student may be restricted to a subset of the school's options. The SPA
 * only ever offers those, so sending another one is a request the parent is
 * not entitled to make.
 */
export function assertTransportationAllowed(student: Student, transportation: Transportation): void {
  if (student.AllowPlans === false) {
    throw new McpToolError(
      `${student.FirstName ?? 'This student'} is not allowed to have plans changed`,
      { hint: 'The school has turned off parent plan changes for this student.' },
    );
  }
  if (transportation.IsLimited !== true) return;
  const allowed = student.LimitedIds ?? [];
  if (!allowed.includes(transportation.TransportationId)) {
    throw new McpToolError(
      `"${transportation.Name}" is restricted and not available to this student`,
      { hint: 'Call pup_list_transportations and pick an option without isLimited, or one the school has granted this student.' },
    );
  }
}

/** Enforce the option's note rule and normalise blank input to `null`. */
export function normalizeNote(
  transportation: Transportation,
  note: string | undefined,
): string | null {
  const trimmed = note?.trim() ?? '';
  if (transportation.IsNoteRequired === true && trimmed === '') {
    throw new McpToolError(`"${transportation.Name}" requires a note`, {
      hint: transportation.NoteHint
        ? `The school describes it as: ${transportation.NoteHint}`
        : 'Pass note with the detail the school expects, e.g. who is collecting the student.',
    });
  }
  return trimmed === '' ? null : trimmed;
}

/**
 * Early-dismissal options require a time; every other option must NOT carry
 * one — the SPA clears the field before sending, so a leftover time would be a
 * value the real client never sends.
 */
export function normalizeEarlyDismissal(
  transportation: Transportation,
  time: string | undefined,
): string | undefined {
  if (transportation.IsEarlyDismissal !== true) return undefined;
  if (!time) {
    throw new McpToolError(`"${transportation.Name}" is an early dismissal and needs a time`, {
      hint: 'Pass early_dismissal_time as HH:MM (24-hour), within the school\'s dismissal window.',
    });
  }
  if (!TIME_OF_DAY.test(time)) {
    throw new McpToolError(`"${time}" is not an HH:MM time`, {
      hint: 'Use 24-hour HH:MM, e.g. 14:30.',
    });
  }
  return time.length === 5 ? `${time}:00` : time;
}

/** Car numbers are sent only for options that use them. */
export function normalizeCarNumber(
  transportation: Transportation,
  carNumber: string | undefined,
): string | undefined {
  if (transportation.UseCarNumbers !== true) return undefined;
  const trimmed = carNumber?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

export interface DefaultPlanInput {
  student: Student;
  dayIds: number[];
  transportation: Transportation;
  note?: string | undefined;
  earlyDismissalTime?: string | undefined;
}

/**
 * Build the `Student` record to PUT back when changing weekly defaults.
 *
 * PickUp Patrol has no default-plans endpoint: the SPA read-modify-writes the
 * whole student, so this returns a copy of the record it was given with only
 * `DefaultPlans` changed. Callers must pass a **freshly read** student, or the
 * PUT will also roll back whatever else changed since.
 */
export function applyDefaultPlans(input: DefaultPlanInput): Student {
  const { student, dayIds, transportation } = input;

  if (dayIds.length === 0) {
    throw new McpToolError('No weekdays given', {
      hint: 'Pass the weekdays to change, e.g. ["Monday","Tuesday"].',
    });
  }
  for (const dayId of dayIds) {
    if (!Number.isInteger(dayId) || dayId < 1 || dayId > 7) {
      throw new McpToolError(`${dayId} is not a weekday id (1 = Sunday … 7 = Saturday)`);
    }
  }

  assertTransportationAllowed(student, transportation);
  const note = normalizeNote(transportation, input.note);
  const earlyDismissalTime = normalizeEarlyDismissal(transportation, input.earlyDismissalTime);

  const plans: DefaultPlan[] = [...(student.DefaultPlans ?? [])].map((plan) => ({ ...plan }));
  for (const dayId of new Set(dayIds)) {
    const existing = plans.find((plan) => plan.DayId === dayId);
    const fields = {
      TransportationId: transportation.TransportationId,
      TransportationName: transportation.Name,
      Note: note,
      EarlyDismissalTime: earlyDismissalTime,
    };
    if (existing) {
      Object.assign(existing, fields);
    } else {
      plans.push({ DayId: dayId, ...fields });
    }
  }

  return { ...student, DefaultPlans: plans };
}

/** Clear every weekday default, the SPA's "start over" action. */
export function clearDefaultPlans(student: Student): Student {
  return { ...student, DefaultPlans: [] };
}
