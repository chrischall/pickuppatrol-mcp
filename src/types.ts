/**
 * Wire types for the PickUp Patrol ServiceStack API.
 *
 * Every field here was read off the shipped SPA's own request/response DTO
 * classes or observed on a live response — see `docs/PICKUPPATROL-API.md` for
 * the capture. Responses are typed loosely on purpose: the API is
 * undocumented, so an unexpected extra field must not break a read.
 */

/** ServiceStack's error envelope, present on any non-2xx JSON body. */
export interface ResponseStatus {
  ErrorCode?: string | null;
  Message?: string | null;
  Errors?: Array<{
    ErrorCode?: string | null;
    FieldName?: string | null;
    Message?: string | null;
  }> | null;
}

export interface AuthenticateResponse {
  UserId?: string | number | null;
  SessionId?: string | null;
  UserName?: string | null;
  DisplayName?: string | null;
  BearerToken?: string | null;
  RefreshToken?: string | null;
  ResponseStatus?: ResponseStatus | null;
}

/** One weekday of a student's recurring dismissal plan. */
export interface DefaultPlan {
  /** 1-based, **Sunday = 1** — the SPA renders `dayNamesMin[DayId - 1]`. */
  DayId: number;
  StudentId?: number;
  TransportationId?: number | null;
  TransportationName?: string | null;
  Note?: string | null;
  WeekDayName?: string | null;
  EarlyDismissalTime?: string | null;
  CarNumber?: string | null;
  UseCarNumbers?: boolean;
}

export interface Student {
  StudentId: number;
  SchoolId: number;
  SchoolName?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  IsActive?: boolean;
  SASId?: string | null;
  TeacherId?: number | null;
  AllowPlans?: boolean;
  CreateDate?: string | null;
  CreatedBy?: number | null;
  ModifiedDate?: string | null;
  ModifiedBy?: number | null;
  DefaultsModifiedDate?: string | null;
  DefaultPlanModifiedBy?: number | null;
  DefaultsReviewedDate?: string | null;
  DefaultsReviewedBy?: number | null;
  DefaultPlans?: DefaultPlan[] | null;
  SafetyFlag?: boolean | null;
  DefaultCarNumber?: string | null;
  LimitedIds?: number[] | null;
}

export interface Transportation {
  TransportationId: number;
  SchoolId: number;
  Name: string;
  NoteHint?: string | null;
  IsNoteRequired?: boolean;
  UseCarNumbers?: boolean;
  IsNotePrivate?: boolean;
  IsActive?: boolean;
  Sequence?: number | null;
  IsEarlyDismissal?: boolean;
  IsLimited?: boolean;
  CutoffTime?: string | null;
  AllowParentCheck?: boolean;
}

export interface PlanEdit {
  PlanDate?: string | null;
  StudentId?: number;
  FirstName?: string | null;
  LastName?: string | null;
  SchoolId?: number;
  TransportationId?: number | null;
  TransportationName?: string | null;
  Note?: string | null;
  IsLocked?: boolean;
  SchoolName?: string | null;
  BusRouteUrl?: string | null;
  ValidationErrors?: unknown;
  EarlyDismissalTime?: string | null;
  CarNumber?: string | null;
  LimitedIds?: number[] | null;
  IsNotePrivate?: boolean;
}

/** One element of the `UpdatePlans` request array. */
export interface PlanUpdate {
  StudentId: number;
  SchoolId: number;
  PlanDate: string;
  TransportationId: number | null;
  TransportationName: string;
  Note: string | null;
  EarlyDismissalTime?: string;
  CarNumber?: string;
}

export interface SessionResponse {
  UserId?: number | null;
  FirstName?: string | null;
  LastName?: string | null;
  DisplayName?: string | null;
  Email?: string | null;
  PrimaryEmail?: string | null;
  LastLoginDate?: string | null;
  HasAcceptedLatestTerms?: boolean;
  SendPlanConfirmEmails?: boolean;
  Children?: Array<{ StudentId: number; SchoolId: number }> | null;
}

export interface School {
  SchoolId: number;
  Name?: string | null;
  IsActive?: boolean;
  TimeZoneId?: string | null;
  HelpPhone?: string | null;
  HelpEmail?: string | null;
  BusRouteUrl?: string | null;
  AllowPlans?: boolean;
  AllowDefaultPlans?: boolean;
  [key: string]: unknown;
}

export interface SchoolNotifyTimes {
  SchoolId: number;
  [key: string]: unknown;
}

export interface DefaultsReviewNeeded {
  StudentId: number;
  NeedsReview: boolean;
}
