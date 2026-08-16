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

## Two things that are easy to get wrong

**`DayId` is 1-based with Sunday = 1.** Verified from a live record where
`DayId: 2` carried `WeekDayName: "Monday"`. Off by one here silently moves a
child's plan to the wrong day.

**There is no default-plans endpoint.** Weekly defaults are changed by PUTting
the *whole* `Student` record back with `DefaultPlans` replaced. Always read the
student immediately before writing — a stale record silently rolls back
everything else that changed.

## Write verification

Writes are verified by re-reading and comparing `TransportationId`.
`ModifiedDate` / `DefaultsModifiedDate` advance on their own and must stay out
of any comparison, or every write reports success. `expectedTransportationId`
returns `undefined` when there is nothing to assert (a revert on a weekday with
no default) and the tool reports `verified: null` — an unknown, never a pass.

## Credentials

A rejected sign-in is cached as a permanent error and never retried:
PickUp Patrol counts attempts against the account and a lockout clears only
through their support desk. Transient failures (5xx, network) stay retryable.
