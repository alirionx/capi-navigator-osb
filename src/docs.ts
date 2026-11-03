import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { VERSION } from './version.js';

/**
 * OpenAPI 3.1 document of the broker, generated from the route schemas, and Swagger UI
 * (OSB0-F-07, ADR-0006): UI at /docs, document at /docs/json. Must be registered before the routes.
 */
export async function registerDocs(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'CAPI Navigator Service Broker',
        version: VERSION,
        description:
          `Open Service Broker API v2.17 for the cluster blueprints of CAPI Navigator ` +
          `(offering \`${config.offering.name}\`). Requests sent from this page are real requests: ` +
          `against a real CAPI Navigator, provisioning creates real clusters.`,
        license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
      },
      components: {
        securitySchemes: {
          brokerAuth: {
            type: 'http',
            scheme: 'basic',
            description: 'Broker username and password (BROKER_USERNAME, BROKER_PASSWORD).',
          },
        },
      },
      tags: [
        { name: 'OSB', description: 'Open Service Broker API, needs basic auth' },
        { name: 'Probes', description: 'Liveness and readiness, no auth' },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });
}
