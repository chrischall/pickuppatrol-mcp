/**
 * Single source of truth for the server's self-reported version.
 *
 * The literal on the VERSION line below is rewritten by release-please (it is
 * registered in `release-please-config.json` under `extra-files`). Everything
 * that needs a version imports this constant rather than repeating the
 * annotation, so there is exactly one line to keep in sync and
 * `versionSyncTest` has exactly one line to check.
 */
export const VERSION = '0.1.2'; // x-release-please-version
