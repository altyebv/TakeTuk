import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { AppConfig } from './config/app-config';
import { AppModule } from './app.module';

const LOG_LEVELS: Record<AppConfig['log']['level'], LogLevel[]> = {
  debug: ['debug', 'log', 'warn', 'error', 'fatal'],
  info: ['log', 'warn', 'error', 'fatal'],
  warn: ['warn', 'error', 'fatal'],
  error: ['error', 'fatal'],
};

export function createLogger(config: AppConfig): ConsoleLogger {
  return new ConsoleLogger({
    json: config.log.format === 'json',
    logLevels: LOG_LEVELS[config.log.level],
    colors: config.log.format === 'text',
  });
}

/** Applies the HTTP settings shared by the server and the test harness. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useBodyParser('json', { limit: '64kb' });
  app.set('trust proxy', config.http.trustProxy);
  app.disable('x-powered-by');
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TAKE-TUK API')
    .setDescription(
      'TAKE-TUK backend API (v1). Conventions: docs/api/API_CONVENTIONS.md. ' +
        'Errors are RFC 9457 problem details with a stable `code`.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Supabase access token',
    })
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
    logger: createLogger(config),
  });
  configureApp(app, config);
  if (config.http.apiDocsEnabled) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }
  return app;
}
