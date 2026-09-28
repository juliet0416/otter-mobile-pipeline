import { mkdirSync, writeFileSync } from 'node:fs';
import { validateInputs } from './runtime.mjs';
const input = validateInputs({
  ref: process.env.OTA_REF, release: process.env.OTA_RELEASE,
  artifact: process.env.OTA_ARTIFACT, channel: process.env.OTA_CHANNEL,
  platform: process.env.OTA_PLATFORM, message: process.env.OTA_MESSAGE,
  dryRun: process.env.OTA_DRY_RUN,
});
mkdirSync('.private', { recursive: true });
writeFileSync('.private/ota-input.json', JSON.stringify(input));
