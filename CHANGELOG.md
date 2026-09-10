# Changelog

## [0.2.1](https://github.com/chrischall/pickuppatrol-mcp/compare/v0.2.0...v0.2.1) (2026-09-10)


### Bug Fixes

* **deps:** @chrischall/mcp-utils 0.26.1 ([#41](https://github.com/chrischall/pickuppatrol-mcp/issues/41)) ([5b47a99](https://github.com/chrischall/pickuppatrol-mcp/commit/5b47a99315aa89b78b73cb25d8c2d84a60d3b073))
* **deps:** Bump hono from 4.13.2 to 4.13.7 ([#39](https://github.com/chrischall/pickuppatrol-mcp/issues/39)) ([c019d11](https://github.com/chrischall/pickuppatrol-mcp/commit/c019d1144587c5f46825c51cd3b41fef45e345cc))
* **deps:** declare the peer floors mcp-utils 0.26.1 requires ([#42](https://github.com/chrischall/pickuppatrol-mcp/issues/42)) ([2e0f77b](https://github.com/chrischall/pickuppatrol-mcp/commit/2e0f77b7f6b04451b8bd349bb8e9ff2b69bfc061))

## [0.2.0](https://github.com/chrischall/pickuppatrol-mcp/compare/v0.1.2...v0.2.0) (2026-09-04)


### Features

* **tools:** minify every response ([#30](https://github.com/chrischall/pickuppatrol-mcp/issues/30)) ([d7cef01](https://github.com/chrischall/pickuppatrol-mcp/commit/d7cef01b961e65ff3addd515a6a531dfd78b965d))

## [0.1.2](https://github.com/chrischall/pickuppatrol-mcp/compare/v0.1.1...v0.1.2) (2026-08-17)


### Refactor

* drop the local hint wrapper for mcp-utils 0.15's built-in ([#7](https://github.com/chrischall/pickuppatrol-mcp/issues/7)) ([5371ed3](https://github.com/chrischall/pickuppatrol-mcp/commit/5371ed33954007bcdd8ce1a3e710abdda2ec4cb8))

## [0.1.1](https://github.com/chrischall/pickuppatrol-mcp/compare/v0.1.0...v0.1.1) (2026-08-16)


### Bug Fixes

* **manifest:** list pup_list_car_numbers, and guard the tool roster against drift ([#5](https://github.com/chrischall/pickuppatrol-mcp/issues/5)) ([32501f1](https://github.com/chrischall/pickuppatrol-mcp/commit/32501f169b2e290d4f342f407ff0a8bc482d214b))

## 0.1.0 (2026-08-16)


### Features

* PickUp Patrol MCP server for school dismissal plans ([a0ca61b](https://github.com/chrischall/pickuppatrol-mcp/commit/a0ca61bdcc9973d113e06bffbc0b2eb67f815198))


### Bug Fixes

* verify plan writes by option and note, and expect a cleared date to read back empty ([#1](https://github.com/chrischall/pickuppatrol-mcp/issues/1)) ([c964b62](https://github.com/chrischall/pickuppatrol-mcp/commit/c964b62976ebe2fd383f9767a9c113b1387a7261))


### Performance

* compute the plan-write expectation once instead of per date ([#4](https://github.com/chrischall/pickuppatrol-mcp/issues/4)) ([548d61e](https://github.com/chrischall/pickuppatrol-mcp/commit/548d61ee2399f1f863c3e46eeaf86ede358ec1ee))
