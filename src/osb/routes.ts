import type { FastifyInstance } from 'fastify';
import { CatalogUnavailableError, type CatalogService } from './catalog.js';
import { sendOsbError } from './errors.js';
import { Catalog, OsbError, osbRoute } from './schemas.js';

/** The OSB routes inside the guarded `/v2` scope. */
export function registerOsbRoutes(v2: FastifyInstance, catalog: CatalogService): void {
  v2.get(
    '/catalog',
    {
      schema: {
        ...osbRoute,
        summary: 'Catalog: one plan per cluster blueprint (OSB1-F-01)',
        response: { 200: Catalog, 500: OsbError },
      },
    },
    async (_req, reply) => {
      try {
        return await catalog.catalog();
      } catch (err) {
        if (err instanceof CatalogUnavailableError) {
          return sendOsbError(reply, 500, err.description);
        }
        throw err;
      }
    },
  );
}
