#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { client } from './client.js';
import { VERSION } from './version.js';
import { registerAccountTools } from './tools/account.js';
import { registerSchoolTools } from './tools/school.js';
import { registerPlanTools } from './tools/plans.js';
import { registerDefaultPlanTools } from './tools/defaults.js';

// The client is a module-level singleton built in ./client.js, not here, so
// the deferred-config-error pattern holds: the server boots and answers the
// host's install-time tools/list probe even with no credentials set, and the
// configuration error only surfaces on the first tool call.
await runMcp({
  name: 'pickuppatrol-mcp',
  version: VERSION,
  deps: client,
  banner:
    '[pickuppatrol-mcp] This project was developed and is maintained by AI. Use at your own discretion.',
  tools: [
    registerAccountTools,
    registerSchoolTools,
    registerPlanTools,
    registerDefaultPlanTools,
  ],
});
