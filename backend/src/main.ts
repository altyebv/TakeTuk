import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigurationError, loadConfig } from './config/app-config';
import { createApp } from './bootstrap';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // Fail closed and loudly: never start with an invalid configuration.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await createApp(config);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`TAKE-TUK API listening on port ${config.port} (${config.nodeEnv})`);
}

void main();
