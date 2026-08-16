# pickuppatrol-mcp

An MCP server for [PickUp Patrol](https://www.pickuppatrol.net/) — the school
dismissal app. Read and change how your children leave school: their weekly
default plan, one-off changes for specific dates, and the school's dismissal
options and cutoff times.

> Developed and maintained by AI (Claude Code). Use at your own discretion.

## What it talks to

`app.pickuppatrol.net` runs a [ServiceStack](https://servicestack.net/) JSON API
behind an Ionic/Vue SPA. There is no published API, but the service is reachable
server-side with an ordinary HTTPS request — no browser extension, no bot wall,
no captcha. The server signs in with your own email and password and holds the
resulting session in memory.

Every request shape is captured in [`docs/PICKUPPATROL-API.md`](docs/PICKUPPATROL-API.md),
read off the shipped client rather than guessed.

## Install

```jsonc
// .mcp.json
{
  "mcpServers": {
    "pickuppatrol": {
      "command": "npx",
      "args": ["-y", "@chrischall/pickuppatrol-mcp"],
      "env": {
        "PICKUPPATROL_USERNAME": "you@example.com",
        "PICKUPPATROL_PASSWORD": "…"
      }
    }
  }
}
```

For local development, copy `.env.example` to `.env` and fill it in.

The server starts without credentials — it answers the host's install-time probe
and only reports the configuration error on the first tool call.

## Tools

**Reads**

| Tool | What it gives you |
|---|---|
| `pup_get_session` | The signed-in account and the students linked to it |
| `pup_list_students` | Every student with their weekly defaults and review flag |
| `pup_get_student` | One student in full |
| `pup_get_default_plans` | A student's weekly default plan, day by day |
| `pup_list_plans` | Day-by-day plans across a date range |
| `pup_get_plan` | One student, one date — including whether it is locked |
| `pup_list_transportations` | A school's dismissal options and the rules each imposes |
| `pup_get_school` | School profile, notify times, cutoff times, settings |
| `pup_list_non_school_days` | Dates no plan can be set for, and dates already changed |
| `pup_list_car_numbers` | Car numbers the school issued to this account |
| `pup_healthcheck` | Credentials sign in and the API answers |

**Writes** — every one requires `confirm: true`. Without it the tool makes no
change and returns a dry-run of the exact payload it would send.

| Tool | What it changes |
|---|---|
| `pup_set_plan` | Dismissal for one or more specific dates, or clears them back to the default |
| `pup_set_default_plans` | The weekly default plan, or clears every default |
| `pup_mark_defaults_reviewed` | The school's "defaults need review" prompt |

### Two things the tools do that the API does not

**Rules are enforced before anything is sent.** Each dismissal option carries its
own requirements — a note, a car number, an early-dismissal time, or a
restriction to particular students. `pup_set_plan` checks them against the
school's own list and refuses with the school's wording, so a rejected write is
a validation message rather than an opaque 400.

**Writes are verified by re-reading.** A 2xx from PickUp Patrol is not proof: a
change made after the school's cutoff is accepted and silently ignored. Every
write re-reads the affected dates and compares the transportation id — never
`ModifiedDate`, which advances on its own and would make every write look
successful. The result says `verified: true/false`, and names the dates that did
not move.

## Without the MCP server

`skills/pickuppatrol-api/` is a shell-out skill covering the same API with
`curl` and `jq`, for scripts or a machine where the server is not installed.

## Development

```bash
npm install
npm run build
npm test              # fast
npm run test:coverage # coverage-enforced at 100%
```

Tests never touch the network: the transport is injected, and the MCP tools run
through a real in-memory client/server pair.

## Safety notes

- A rejected sign-in is **never retried**. PickUp Patrol counts failed attempts
  against the account and a lockout clears only through their support desk, so
  the error is cached and every later call fails instantly with the same message.
- The weekly-default write is a read-modify-write of the whole student record,
  because the API has no default-plans endpoint. The server always reads the
  student immediately before writing, and changes only `DefaultPlans`.
- Credentials live in `.env` (gitignored) or the MCP host's config, and are
  never written to a result or a log.

## License

MIT
