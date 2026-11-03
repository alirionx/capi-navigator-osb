/** JSON schemas of the OSB routes, for validation and the OpenAPI document (ADR-0006). */

/** Headers of every OSB request; the guard checks version and auth before validation. */
export const OsbHeaders = {
  type: 'object',
  properties: {
    'x-broker-api-version': {
      type: 'string',
      default: '2.17',
      description: 'Version of the OSB API the platform uses (at least 2.13).',
    },
    'x-broker-api-originating-identity': {
      type: 'string',
      description: 'Platform user who caused the request: `<platform> <base64 JSON>`.',
    },
    'x-broker-api-request-identity': {
      type: 'string',
      description: 'ID of the request, echoed in the response.',
    },
  },
  required: ['x-broker-api-version'],
} as const;

export const OsbError = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['description'],
} as const;

const Plan = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    free: { type: 'boolean' },
    bindable: { type: 'boolean' },
    plan_updateable: { type: 'boolean' },
    maximum_polling_duration: { type: 'integer' },
    metadata: { type: 'object', additionalProperties: true },
    schemas: {
      type: 'object',
      properties: {
        service_instance: {
          type: 'object',
          properties: {
            create: {
              type: 'object',
              properties: {
                // The blueprint's parametersSchema, passed through unchanged (OSB1-F-02).
                parameters: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
  required: ['id', 'name', 'description'],
} as const;

export const Catalog = {
  type: 'object',
  properties: {
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          bindable: { type: 'boolean' },
          plan_updateable: { type: 'boolean' },
          instances_retrievable: { type: 'boolean' },
          bindings_retrievable: { type: 'boolean' },
          metadata: { type: 'object', additionalProperties: true },
          plans: { type: 'array', items: Plan },
        },
        required: ['id', 'name', 'description', 'bindable', 'plans'],
      },
    },
  },
  required: ['services'],
} as const;

/** Route options shared by all OSB routes. */
export const osbRoute = { tags: ['OSB'], security: [{ brokerAuth: [] }], headers: OsbHeaders };
