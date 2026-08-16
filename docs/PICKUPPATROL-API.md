# PickUp Patrol API — captured request/response shapes

`app.pickuppatrol.net` runs a **ServiceStack** backend behind a Vite/Ionic-Vue SPA
served at `/parents/`. There is no published API and no metadata endpoint
(`/metadata`, `/types/typescript`, `/openapi` all 404 in production), but the
service is a plain typed JSON API that is **reachable server-side** — no bot
wall, no captcha, no app-key header.

Everything below was captured on **2026-08-16** from three sources, all of which
are the real thing rather than a guess:

1. **The shipped SPA bundles** (`/parents/assets/index-*.js` and its lazily
   loaded route chunks) — every request DTO is a class carrying its own
   `getTypeName()` / `getMethod()`, so the wire name, HTTP verb and full field
   list are read directly off the client. Write payloads are transcribed from
   the call sites that build them.
2. **Live in-tab `fetch` calls** against a signed-in session, returning key sets
   only. No credential, cookie or token value was captured or committed.
3. **Live server-side calls through this repo's own built client**, including a
   write and its restore on a real account — see *Live verification* at the end.

## Transport

| | |
|---|---|
| Base URL | `https://app.pickuppatrol.net` |
| Base path | `/api/json/reply` |
| Request URL | `POST\|GET\|PUT\|PATCH {base}/api/json/reply/{RequestDtoName}` |
| GET args | query string (`?StudentId=123&PlanDate=2026-08-17`) |
| Body args | JSON body, `Content-Type: application/json` |
| Auth | ServiceStack session cookies (`ss-id`, `ss-pid`, `ss-opt`) — see below |

The SPA constructs its client as:

```js
const client = JsonServiceClient.create('https://app.pickuppatrol.net');
client.basePath = '/api/json/reply';
client.headers.set('Content-Type', 'application/json');
const t = localStorage.getItem('bearerToken');
if (t) client.bearerToken = t;
```

### Errors

Non-2xx responses carry a ServiceStack `ResponseStatus`:

```json
{
  "ResponseStatus": {
    "ErrorCode": "LOGIN-ERROR-EMAIL-NOT-FOUND",
    "Message": "Couldn't find your PickUp Patrol Account. …",
    "Errors": [{ "ErrorCode": "…", "FieldName": "UserName", "Message": "…" }]
  }
}
```

Unauthenticated requests to any authorised endpoint return a bare **401** with
an empty body.

## Authentication

### `POST /Authenticate`

```json
{ "provider": "credentials", "UserName": "<email>", "Password": "<password>", "RememberMe": true }
```

Full field list on the DTO: `provider`, `State`, `oauth_token`,
`oauth_verifier`, `UserName`, `Password`, `RememberMe`, `ErrorView`, `nonce`,
`uri`, `response`, `qop`, `nc`, `cnonce`, `AccessToken`, `AccessTokenSecret`,
`scope`, `Meta`. Only the four above are used by the SPA.

Response: `{ UserId, SessionId, UserName, DisplayName, ReferrerUrl,
BearerToken, RefreshToken, ProfileUrl, Roles, Permissions, ResponseStatus, Meta }`.

**This deployment authenticates by cookie, not by JWT.** A live sign-in returns
`BearerToken: null` and `RefreshToken: null`, and sets `ss-id` / `ss-pid` /
`ss-opt` (plus Azure's `ARRAffinity` pair). The SPA agrees: its client reads a
`bearerToken` out of `localStorage`, but nothing ever writes one, and it fetches
with `credentials: 'include'`. Keep whichever the server returns and send both —
the JWT plumbing exists server-side and may be switched on.

**Probe result (2026-08-16)** — a deliberately nonexistent `@example.com`
address returned `400` with `ErrorCode: LOGIN-ERROR-EMAIL-NOT-FOUND`, i.e. the
API accepted our client identity outright and only rejected the account. No
capture or browser bridge is required.

### Two-factor (optional, per account)

`User.OtpTypeId` / `User.OtpPhone` gate it; the SPA routes to `/two-factor`.

- `POST /CreateOtp` `{ OtpTypeId }` — send the code
- `PUT  /VerifyOtp` `{ Otp, RememberMe }` — redeem it

### Token refresh

- `POST /GetAccessToken` `{ refreshToken, useTokenCookie }`
- `GET  /RequestNewtoken?OldToken=…`

Never retry a rejected password — see `README.md`; repeated failures lock the
account out through the support desk, not through a timer.

## Reads

| DTO | Verb | Args | Response |
|---|---|---|---|
| `GetSession` | GET | — | `{ UserId, HasAcceptedLatestTerms, SendPlanConfirmEmails, SchoolId, SchoolName, Children[{StudentId,SchoolId}], FirstName, LastName, DisplayName, Email, PrimaryEmail, LastLoginDate, … }` |
| `GetSessionInfo` | GET | — | session/user detail |
| `GetChildren` | GET | — | `Student[]` (see below) |
| `GetStudent` | GET | `StudentId`, `MergeTimeWithNote?` | `Student` |
| `GetDefaultPlansReviewNeeded` | GET | — | `[{ StudentId, NeedsReview }]` |
| `GetParentPlans` | GET | `StartDate`, `EndDate` | day-plan records for the range |
| `GetPlanEdit` | GET | `PlanDate`, `StudentId` | `{ PlanDate, StudentId, FirstName, LastName, SchoolId, TransportationId, Note, IsLocked, TransportationName, SchoolName, BusRouteUrl, ValidationErrors, EarlyDismissalTime, CarNumber, LimitedIds, IsNotePrivate }` — the date's **override**, not the effective plan (see below) |
| `GetBoldedDates` | GET | `StartDate`, `EndDate` | `string[]` — dates with a non-default plan |
| `GetInvalidPlanDates` | GET | `SchoolId` | `string[]` — non-school days (105 entries on the captured account) |
| `GetTransportations` | GET | `SchoolId` | dismissal options (see below) |
| `GetCarNumbers` | GET | `SchoolId` | `string[]` |
| `GetSchool` | GET | `SchoolId` | `School` |
| `GetSchoolNotifyTimes` | GET | `SchoolId` | `{ SchoolId, NotifyTime{Sunday…Saturday}, CutoffTime{Sunday…Saturday} }` |
| `GetSchoolSettings` | GET | `SchoolId` | `{ General, SchoolId, Active, Welcome, CarTag, LateArrival, LeaveAndReturn, EarlyDismissal, UpdateFields }` |
| `GetMiddayPlan` | GET | `StudentId`, `PlanDate`, `TypeId?` | midday checkout/checkin record |
| `GetParentHealthScreenAudits` | GET | `ScreenDate` | health-screen audits |
| `GetTermsOfUse` | GET | — | current terms |

### `Student`

```
StudentId, SchoolId, SchoolName, FirstName, LastName, IsActive, SASId,
TeacherId, AllowPlans, CreateDate, CreatedBy, ModifiedDate, ModifiedBy,
DefaultsModifiedDate, DefaultPlanModifiedBy, DefaultsReviewedDate,
DefaultsReviewedBy, DefaultPlans[], SafetyFlag, DefaultCarNumber, LimitedIds[]
```

`DefaultPlans[]` entries:

```json
{
  "StudentId": 1050046, "DayId": 2, "TransportationId": 41246,
  "Note": "Chris Hall", "TransportationName": "PickUp",
  "WeekDayName": "Monday", "EarlyDismissalTime": null,
  "CarNumber": null, "UseCarNumbers": false
}
```

**`DayId` is 1-based with Sunday = 1** (verified: `DayId: 2` ⇄ `"Monday"`). The
SPA renders the label as `dayNamesMin[DayId - 1]`.

### Transportation

```
TransportationId, SchoolId, Name, NoteHint, IsNoteRequired, UseCarNumbers,
IsNotePrivate, IsActive, Sequence, IsEarlyDismissal, CreateDate, CreatedBy,
ModifiedDate, ModifiedBy, IsLimited, CutoffTime, CutoffTime{Sunday…Saturday},
AllowParentCheck
```

Client-side rules read off `plans-day-view`:

- `IsNoteRequired` → `Note` must be non-empty.
- `UseCarNumbers` → send `CarNumber`; otherwise omit it entirely.
- `IsEarlyDismissal` → `EarlyDismissalTime` is required and must fall in the
  `07:00:00`…`CutoffTime` slot list; for every other transportation the client
  **clears** it before sending.
- `IsLimited` → only offered when the transportation id appears in the
  student's `LimitedIds`.

### `GetPlanEdit` returns the override, not the effective plan

A date with no specific plan reads back `TransportationId: null` **even when the
student has a weekly default for that weekday** — verified live on a Friday for
a student whose Friday default is set. So:

- to know what actually happens on a date, read `GetPlanEdit` and fall back to
  `GetStudent(...).DefaultPlans[DayId]` yourself;
- after clearing a date, expect `null` — expecting the weekday default would
  report every successful revert as a failure.

## Writes

### `PUT /UpdatePlans` — change dismissal for specific dates

The one-off (calendar) path. `Plans` is an array; one entry per date, so a
single call can set several dates at once.

```json
{
  "Plans": [
    {
      "StudentId": 1050046,
      "SchoolId": 1703,
      "PlanDate": "2026-08-17",
      "TransportationId": 41246,
      "TransportationName": "PickUp",
      "Note": "Chris Hall",
      "EarlyDismissalTime": null,
      "CarNumber": null
    }
  ]
}
```

**Revert a date to the student's default plan** — same call with a null
transportation:

```json
{ "Plans": [{ "StudentId": …, "SchoolId": …, "PlanDate": "2026-08-17",
              "TransportationId": null, "TransportationName": "Default plan",
              "Note": null }] }
```

`TransportationName` is display text the client fills in from the chosen
transportation (and, on the revert path, from its own `DEFAULT-PLAN-OPTION`
localisation string) — `TransportationId` is what the server acts on.

### `PUT /Student` — change the weekly default plans

There is **no** dedicated default-plans endpoint. The SPA does a
read-modify-write of the whole `Student` object:

```js
const payload = { ...student, DefaultPlans: [...student.DefaultPlans] };
for (const day of selectedDays) {
  const existing = payload.DefaultPlans.find(p => p.DayId === day.dayId);
  if (existing) {
    existing.TransportationId = id;
    existing.TransportationName = name;
    existing.Note = note;
    existing.EarlyDismissalTime = isEarlyDismissal ? time : undefined;
  } else {
    payload.DefaultPlans.push({ DayId: day.dayId, TransportationId: id,
                                TransportationName: name, Note: note,
                                EarlyDismissalTime: … });
  }
}
await updateStudent(payload);          // PUT /Student
```

Clearing every default is `{ ...student, DefaultPlans: [] }`.

Because the whole record round-trips, **always `GetStudent` first and send back
every field verbatim**, mutating only `DefaultPlans`. The `Student` DTO the SPA
sends carries exactly: `StudentId, SchoolId, SchoolName, FirstName, LastName,
IsActive, SASId, TeacherId, AllowPlans, CreateDate, CreatedBy, ModifiedDate,
ModifiedBy, DefaultsModifiedDate, DefaultPlanModifiedBy, DefaultsReviewedDate,
DefaultsReviewedBy, DefaultPlans, SafetyFlag, DefaultCarNumber, LimitedIds`.

### Other writes

| DTO | Verb | Body |
|---|---|---|
| `SetDefaultsReviewed` | PUT | `{ StudentId, Reviewed }` |
| `UpdateMiddayPlanCheck` | PUT | `{ StudentId, PlanDate, TypeId, Action }` |
| `MiddayPlan` | PUT | full midday-plan record |
| `UpdateSendPlanConfirmationEmail` | PUT | `{ Send }` |
| `UpdateUserLanguage` | PATCH | `{ Language }` |
| `AcceptTerms` | PUT | — |
| `ChangePassword` | PUT | `{ CurrentPassword, NewPassword, ConfirmPassword }` |
| `SetDefaultsReviewed` | PUT | `{ StudentId, Reviewed }` |

## Permission gates

Every dismissal option observed so far sets `IsNoteRequired`, so in practice a
plan always carries a `Note` — and a **note-only edit is an ordinary change**.
Anything verifying a write must compare the note as well as the transportation
id, or it reports success from a comparison that could never have moved.

Writing plans is refused client-side (and rejected server-side) unless:

- `GetSchoolSettings(...).General.AllowDefaultPlans` — for default plans, and
- `Student.AllowPlans` — per student.

Which weekdays a school even has default plans for is derived from
`GetSchoolNotifyTimes`: a day with no `NotifyTime<Day>` is not a school day.

## Verifying a write

A 2xx from `UpdatePlans` / `Student` is **not** proof the change persisted —
re-read and diff. Use `GetPlanEdit(PlanDate, StudentId)` for a one-off plan and
`GetStudent(StudentId).DefaultPlans` for defaults. Exclude `ModifiedDate` (and
`DefaultsModifiedDate`) from the comparison: they advance on their own and
would make every write look successful.

## Live verification

Exercised against a real parent account on **2026-08-16**, through this repo's
built client and its actual MCP tools:

- **Sign-in** — server-side `Authenticate` with an email and password succeeds
  and returns cookies only, no JWT.
- **Every read DTO listed above** — `GetSession`, `GetChildren`, `GetStudent`,
  `GetTransportations`, `GetPlanEdit`, `GetInvalidPlanDates`,
  `GetSchoolSettings`, `GetSchoolNotifyTimes`,
  `GetDefaultPlansReviewNeeded`.
- **`UpdatePlans`** — a date set to an option and note, confirmed by re-read,
  then cleared, confirmed by re-read (`GetBoldedDates` back to `[]`).
- **`Student`** (weekly defaults) — one weekday's note changed, confirmed by
  re-read, then restored, confirmed by re-read.

Both writes were chosen so a failed restore would be harmless: the one-off date
was set to the option its weekday default already used, and the default edit
*narrowed* a note rather than widening it.
