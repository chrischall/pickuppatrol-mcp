# Changelog

## [1.1.4](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.1.3...v1.1.4) (2026-10-05)


### Bug Fixes

* **deps:** Bump dotenv from 18.0.3 to 18.0.5 in the production-dependencies group ([#76](https://github.com/chrischall/pickuppatrol-mcp/issues/76)) ([db3f91e](https://github.com/chrischall/pickuppatrol-mcp/commit/db3f91e230d8b51e2b66bcd40216ab5df1790841))
* **deps:** require @chrischall/mcp-utils 2.14.0 and MCP SDK 2.3.0 ([#78](https://github.com/chrischall/pickuppatrol-mcp/issues/78)) ([420fde1](https://github.com/chrischall/pickuppatrol-mcp/commit/420fde1ba48359728eef0abaf4740fb3a77e54c3))

## [1.1.3](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.1.2...v1.1.3) (2026-10-03)


### Bug Fixes

* **deps:** adopt @chrischall/mcp-utils 2.12.0 confirmWrite kit ([#71](https://github.com/chrischall/pickuppatrol-mcp/issues/71)) ([9a61483](https://github.com/chrischall/pickuppatrol-mcp/commit/9a6148394ab4f5872126bb9ba203e748ed18abe4))
* **deps:** bump @chrischall/mcp-utils to 2.10.0 ([#69](https://github.com/chrischall/pickuppatrol-mcp/issues/69)) ([1cbe0c4](https://github.com/chrischall/pickuppatrol-mcp/commit/1cbe0c4a48e6d179b323385dde687098e8d087a5))
* **deps:** bump @chrischall/mcp-utils to 2.13.0 ([#73](https://github.com/chrischall/pickuppatrol-mcp/issues/73)) ([f4acc15](https://github.com/chrischall/pickuppatrol-mcp/commit/f4acc154038610fe2da2ee1ae0a894f4159137cf))
* **healthcheck:** report why pup_healthcheck failed and stop blaming the password for CDN blocks ([#72](https://github.com/chrischall/pickuppatrol-mcp/issues/72)) ([a573be2](https://github.com/chrischall/pickuppatrol-mcp/commit/a573be2d0541e5eace9b255aa1b0446aac3bcaf3))
* keep write approvals valid across a hosted restart (mcp-utils 2.11.0) ([#70](https://github.com/chrischall/pickuppatrol-mcp/issues/70)) ([ade0037](https://github.com/chrischall/pickuppatrol-mcp/commit/ade00371d8fbc2f6e1afd68bb0e7d25802dd3965))
* report CDN/WAF blocks as edge_blocked, not a rejected credential (mcp-utils 2.9.0) ([#66](https://github.com/chrischall/pickuppatrol-mcp/issues/66)) ([110eab0](https://github.com/chrischall/pickuppatrol-mcp/commit/110eab0261efaff38bb677425892fc2ba2ddb837))

## [1.1.2](https://github.com/chrischall/pickuppatrol-mcp/compare/v1.1.1...v1.1.2) (2026-09-27)


### Bug Fixes

* **deps:** Bump the production-dependencies group with 2 updates ([#64](https://github.com/chrischall/pickuppatrol-mcp/issues/64)) ([996c613](https://github.com/chrischall/pickuppatrol-mcp/commit/996c613bd9361298346592bd534c6e127a9e9657))

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
