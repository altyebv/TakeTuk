import { applyDecorators, Param, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiExtension,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import type { ErrorCode } from '../errors/error-codes';
import { validParam, validQuery } from './zod-validation.pipe';

/**
 * Named schemas (Zod `.meta({ id })`) are hoisted into OpenAPI `components/schemas` instead of
 * being inlined at every use. Filled as controllers are decorated; read by the document builder.
 */
const COMPONENTS = new Map<string, string>();

export function openApiComponents(): Record<string, SchemaObject> {
  return Object.fromEntries(
    [...COMPONENTS.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, json]) => [id, JSON.parse(json) as SchemaObject]),
  );
}

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) =>
        key === '$ref' && typeof v === 'string'
          ? [key, v.replace('#/definitions/', '#/components/schemas/')]
          : [key, rewriteRefs(v)],
      ),
    );
  }
  return value;
}

/** Converts a Zod schema to an OpenAPI 3.0 schema object (ADR-0014: one schema, two uses). */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  const definitions = (json.definitions ?? {}) as Record<string, unknown>;
  delete json.definitions;
  for (const [id, definition] of Object.entries(definitions)) {
    const serialized = JSON.stringify(rewriteRefs(definition));
    const existing = COMPONENTS.get(id);
    if (existing !== undefined && existing !== serialized) {
      throw new Error(`OpenAPI component id '${id}' is used by two different schemas`);
    }
    COMPONENTS.set(id, serialized);
  }
  return rewriteRefs(json) as SchemaObject;
}

export const ApiZodBody = (schema: z.ZodType, description?: string) =>
  ApiBody({ schema: toOpenApiSchema(schema, 'input'), ...(description ? { description } : {}) });

export const ApiZodResponse = (status: number, schema: z.ZodType, description: string) =>
  ApiResponse({ status, description, schema: toOpenApiSchema(schema, 'output') });

/**
 * Validated path parameters, documented from the same Zod object schema. The Swagger explorer
 * only sees named `@Param('x')` parameters, so a whole-object `@Param(pipe)` would leave them
 * out of the contract.
 */
export const ZodParams = (schema: z.ZodObject): ParameterDecorator =>
  documentedParameters(schema, 'path', Param(validParam(schema)));

/** Validated query parameters, documented from the same Zod object schema. */
export const ZodQuery = (schema: z.ZodObject): ParameterDecorator =>
  documentedParameters(schema, 'query', Query(validQuery(schema)));

function documentedParameters(
  schema: z.ZodObject,
  location: 'path' | 'query',
  bind: ParameterDecorator,
): ParameterDecorator {
  const json = toOpenApiSchema(schema, 'input');
  const required = new Set(json.required ?? []);
  const properties = Object.entries(json.properties ?? {}) as Array<[string, SchemaObject]>;
  return (target, key, index) => {
    bind(target, key, index);
    const descriptor = key === undefined ? undefined : Object.getOwnPropertyDescriptor(target, key);
    if (key === undefined || !descriptor) {
      throw new Error('ZodParams and ZodQuery decorate route handler parameters only');
    }
    for (const [name, property] of properties) {
      const options = {
        name,
        required: location === 'path' || required.has(name),
        schema: property,
      };
      (location === 'path' ? ApiParam(options) : ApiQuery(options))(target, key, descriptor);
    }
  };
}

const problemSchema: SchemaObject = {
  type: 'object',
  required: ['type', 'title', 'status', 'code', 'detail'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    requestId: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
};

export interface EndpointDoc {
  readonly operationId: string;
  readonly summary: string;
  readonly tag: string;
  /** Problem codes this endpoint can return (besides authentication/validation basics). */
  readonly problems?: readonly ErrorCode[];
  readonly description?: string;
}

/** Operation-level documentation: id, summary, tag and the documented problem codes. */
export function ApiEndpoint(doc: EndpointDoc) {
  const problems = doc.problems ?? [];
  const description = [
    doc.description,
    problems.length > 0
      ? `Problem codes: ${problems.map((c) => `\`${c}\``).join(', ')}.`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  return applyDecorators(
    ApiTags(doc.tag),
    ApiOperation({
      operationId: doc.operationId,
      summary: doc.summary,
      ...(description ? { description } : {}),
    }),
    ApiExtension('x-taketuk-problem-codes', [...problems]),
    ApiResponse({
      status: 'default',
      description: 'Problem details (RFC 9457)',
      content: { 'application/problem+json': { schema: problemSchema } },
    }),
  );
}
