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

export const InstanceParams = {
  type: 'object',
  properties: { instance_id: { type: 'string', description: 'Instance ID (a UUID).' } },
  required: ['instance_id'],
} as const;

export const ProvisionBody = {
  type: 'object',
  properties: {
    service_id: { type: 'string' },
    plan_id: { type: 'string' },
    parameters: {
      type: 'object',
      additionalProperties: true,
      description: 'Parameters of the plan, see its schema in the catalog.',
    },
    context: { type: 'object', additionalProperties: true },
    organization_guid: { type: 'string' },
    space_guid: { type: 'string' },
  },
  required: ['service_id', 'plan_id'],
} as const;

export const AcceptsIncompleteQuery = {
  type: 'object',
  properties: {
    accepts_incomplete: {
      type: 'boolean',
      description: 'Must be true: the broker works asynchronously.',
    },
  },
} as const;

export const DeprovisionQuery = {
  type: 'object',
  properties: {
    ...AcceptsIncompleteQuery.properties,
    service_id: { type: 'string' },
    plan_id: { type: 'string' },
  },
  required: ['service_id', 'plan_id'],
} as const;

export const LastOperationQuery = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: ['provision', 'deprovision'] },
    service_id: { type: 'string' },
    plan_id: { type: 'string' },
  },
} as const;

export const Operation = {
  type: 'object',
  properties: { operation: { type: 'string', enum: ['provision', 'deprovision'] } },
} as const;

export const LastOperation = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['in progress', 'succeeded', 'failed'] },
    description: { type: 'string' },
  },
  required: ['state'],
} as const;

export const Empty = { type: 'object', additionalProperties: false } as const;
