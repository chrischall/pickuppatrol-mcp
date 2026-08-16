# pickuppatrol-mcp — repo notes

Only what is true of *this* repo. Fleet-wide conventions live in
`~/.claude/CLAUDE.md` and are not repeated here.

## The API

PickUp Patrol is a ServiceStack backend: one URL per request DTO at
`/api/json/reply/<DtoName>`, verb declared by the DTO. The shipped SPA carries
every DTO as a class with its own `getTypeName()` / `getMethod()`, so
`docs/PICKUPPATROL-API.md` was transcribed from the real client, not guessed.
Route chunks are lazily loaded — `plan.store-*.js` and
`default-plans-details-*.js` are where the write payloads are built.

Production has metadata disabled (`/metadata`, `/types/typescript`, `/openapi`
all 404), so the bundle is the only machine-readable source. Re-derive from
`/parents/assets/index-*.js` if the API moves.

Live-verified against a real parent account on 2026-08-16: server-side sign-in,
every read DTO, `UpdatePlans` + restore, and the `Student` default-plans PUT +
restore. Sign-in returns **cookies only** — `BearerToken` is null on this
deployment, though the JWT plumbing exists server-side.

## Three things that are easy to get wrong

**`DayId` is 1-based with Sunday = 1.** Verified from a live record where
`DayId: 2` carried `WeekDayName: "Monday"`. Off by one here silently moves a
child's plan to the wrong day.

**There is no default-plans endpoint.** Weekly defaults are changed by PUTting
the *whole* `Student` record back with `DefaultPlans` replaced. Always read the
student immediately before writing — a stale record silently rolls back
everything else that changed.

**`GetPlanEdit` returns the date's override, not the effective plan.** A date
with no specific plan reads back `TransportationId: null` even when the student
has a weekly default for that weekday — verified live on a Friday for a student
whose Friday default is set. So a *cleared* date must be expected to read back
null; expecting the weekday default reports every good revert as a failure.

## Write verification

Writes are verified by re-reading and comparing `TransportationId` **and
`Note`**. The note is load-bearing: every dismissal option observed sets
`IsNoteRequired`, so a note-only edit is an ordinary change, and comparing the
id alone would report success from a field that never had to move — the same
false-green as diffing a field that cannot change.

`ModifiedDate` / `DefaultsModifiedDate` advance on their own and must stay out
of any comparison, or every write reports success.

## Credentials

A rejected sign-in is cached as a permanent error and never retried:
PickUp Patrol counts attempts against the account and a lockout clears only
through their support desk. Transient failures (5xx, network) stay retryable.
