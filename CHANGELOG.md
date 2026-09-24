# Changelog

## [1.1.1](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.1.0...v1.1.1) (2026-09-24)


### Bug Fixes

* **deps:** Bump dotenv from 17.4.2 to 18.0.2 in the production-majors group ([#61](https://github.com/chrischall/pickuppatrol-mcp/issues/61)) ([40edd89](https://github.com/chrischall/pickuppatrol-mcp/commit/40edd894c33bba15d6ba0210395a2a4255747c00))

## [1.1.0](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.0.2...v1.1.0) (2026-09-24)


### Features

* confirm writes with a preview token instead of confirm: true ([#57](https://github.com/chrischall/pickuppatrol-mcp/issues/57)) ([b517185](https://github.com/chrischall/pickuppatrol-mcp/commit/b517185eb1cd5d095f7019227f8c1c3e53948a00))

## [1.0.2](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.0.1...v1.0.2) (2026-09-23)


### Bug Fixes

* bound the sign-in, verify plan time/car number, and stop re-signing-in 2FA accounts ([#55](https://github.com/chrischall/pickuppatrol-mcp/issues/55)) ([f3eeffe](https://github.com/chrischall/pickuppatrol-mcp/commit/f3eeffe5bf55eb632210ed165e86ffca597f9984))

## [1.0.1](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.0.0...v1.0.1) (2026-09-23)


### Bug Fixes

* **deps:** require zod ^4.6.5 to match @chrischall/mcp-utils 2.4.0 ([#54](https://github.com/chrischall/pickuppatrol-mcp/issues/54)) ([12065b8](https://github.com/chrischall/pickuppatrol-mcp/commit/12065b85b6d4f19a803c33a9e5a681ce78f97785))
* **deps:** upgrade @chrischall/mcp-utils to 2.4.0 and @fetchproxy/* to 3.2.0 ([#52](https://github.com/chrischall/pickuppatrol-mcp/issues/52)) ([5d36809](https://github.com/chrischall/pickuppatrol-mcp/commit/5d36809698661e3169a32b896913f827eb593ef0))

## [1.0.0](https://github.com/chrischall/pickuppatrol-mcp/compare/v0.2.1...v1.0.0) (2026-09-20)


### ⚠ BREAKING CHANGES

* **mcp:** migrate server to SDK v2 and take mcp-utils 1.0.0 ([#49](https://github.com/chrischall/pickuppatrol-mcp/issues/49))

### Features

* **mcp:** migrate server to SDK v2 and take mcp-utils 1.0.0 ([#49](https://github.com/chrischall/pickuppatrol-mcp/issues/49)) ([47a297c](https://github.com/chrischall/pickuppatrol-mcp/commit/47a297c2c0f727a2357868d61d5e27a0105ca649))


### Bug Fixes

* **release:** drop bump-minor-pre-major so a breaking change cuts a major ([#51](https://github.com/chrischall/pickuppatrol-mcp/issues/51)) ([ce25c72](https://github.com/chrischall/pickuppatrol-mcp/commit/ce25c72b60dde117bcc7ee76f1d9c5ea04bef541))

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
