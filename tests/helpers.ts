import { vi } from 'vitest';
import type { PickUpPatrolClient } from '../src/client.js';
import type { Student, Transportation } from '../src/types.js';

export const SCHOOL_ID = 1703;
export const STUDENT_ID = 1050046;

export const PICKUP: Transportation = {
  TransportationId: 41246,
  SchoolId: SCHOOL_ID,
  Name: 'PickUp',
  IsActive: true,
  IsNoteRequired: true,
  NoteHint: 'Who is collecting?',
};

export const BUS: Transportation = {
  TransportationId: 41245,
  SchoolId: SCHOOL_ID,
  Name: 'Bus',
  IsActive: true,
};

export const EARLY: Transportation = {
  TransportationId: 41247,
  SchoolId: SCHOOL_ID,
  Name: 'Early dismissal',
  IsActive: true,
  IsEarlyDismissal: true,
};

export const INACTIVE: Transportation = {
  TransportationId: 41248,
  SchoolId: SCHOOL_ID,
  Name: 'Retired option',
  IsActive: false,
};

export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    StudentId: STUDENT_ID,
    SchoolId: SCHOOL_ID,
    SchoolName: 'Whitewater Center',
    FirstName: 'Lucas',
    LastName: 'Hall',
    AllowPlans: true,
    LimitedIds: [],
    DefaultPlans: [
      {
        DayId: 2,
        TransportationId: PICKUP.TransportationId,
        TransportationName: 'PickUp',
        Note: 'Chris Hall',
        WeekDayName: 'Monday',
      },
    ],
    ...overrides,
  };
}

/** A `PickUpPatrolClient` stand-in: every method a spy, sensible defaults. */
export function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const student = makeStudent();
  const base = {
    getSession: vi.fn().mockResolvedValue({
      UserId: 42,
      DisplayName: 'Chris Hall',
      Email: 'parent@example.com',
      Children: [{ StudentId: STUDENT_ID, SchoolId: SCHOOL_ID }],
    }),
    getChildren: vi.fn().mockResolvedValue([student]),
    getStudent: vi.fn().mockResolvedValue(student),
    getDefaultPlansReviewNeeded: vi
      .fn()
      .mockResolvedValue([{ StudentId: STUDENT_ID, NeedsReview: true }]),
    getParentPlans: vi.fn().mockResolvedValue([]),
    getPlanEdit: vi.fn().mockResolvedValue({
      PlanDate: '2026-08-17',
      StudentId: STUDENT_ID,
      TransportationId: BUS.TransportationId,
      TransportationName: 'Bus',
      Note: null,
      IsLocked: false,
    }),
    getTransportations: vi.fn().mockResolvedValue([PICKUP, BUS, EARLY, INACTIVE]),
    getCarNumbers: vi.fn().mockResolvedValue(['12']),
    getSchool: vi.fn().mockResolvedValue({ SchoolId: SCHOOL_ID, Name: 'Whitewater Center' }),
    getSchoolNotifyTimes: vi.fn().mockResolvedValue({ SchoolId: SCHOOL_ID }),
    getSchoolSettings: vi.fn().mockResolvedValue({ General: { AllowDefaultPlans: true } }),
    getInvalidPlanDates: vi.fn().mockResolvedValue(['2026-08-15']),
    getBoldedDates: vi.fn().mockResolvedValue(['2026-08-17']),
    updatePlans: vi.fn().mockResolvedValue(undefined),
    updateStudent: vi.fn().mockResolvedValue(undefined),
    setDefaultsReviewed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return base as unknown as PickUpPatrolClient & typeof base;
}
