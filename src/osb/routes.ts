import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { CatalogUnavailableError, type CatalogService } from './catalog.js';
import { OsbFailure, sendOsbError } from './errors.js';
import type { InstanceService, ProvisionRequest } from './instances.js';
import {
  AcceptsIncompleteQuery,
  Catalog,
  DeprovisionQuery,
  Empty,
  InstanceParams,
  LastOperation,
  LastOperationQuery,
  Operation,
  OsbError,
  ProvisionBody,
  osbRoute,
} from './schemas.js';

type InstanceRoute = { Params: { instance_id: string } };

/** The OSB routes inside the guarded `/v2` scope. */
export function registerOsbRoutes(
  v2: FastifyInstance,
  deps: { config: Config; catalog: CatalogService; instances: InstanceService },
): void {
  const { config, catalog, instances } = deps;

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

  v2.put<InstanceRoute & { Body: ProvisionRequest; Querystring: { accepts_incomplete?: boolean } }>(
    '/service_instances/:instance_id',
    {
      schema: {
        ...osbRoute,
        summary: 'Provision: create a cluster from the blueprint of the plan (OSB2-F-02)',
        params: InstanceParams,
        querystring: AcceptsIncompleteQuery,
        body: ProvisionBody,
        response: { 200: Empty, 202: Operation, '4xx': OsbError, '5xx': OsbError },
      },
    },
    async (req, reply) => {
      const r = await instances.provision(
        req.params.instance_id,
        req.body,
        req.query.accepts_incomplete === true,
      );
      return reply.code(r.status).send(r.body);
    },
  );

  v2.delete<
    InstanceRoute & {
      Querystring: { accepts_incomplete?: boolean; service_id: string; plan_id: string };
    }
  >(
    '/service_instances/:instance_id',
    {
      schema: {
        ...osbRoute,
        summary: 'Deprovision: delete the cluster with cleanup (OSB2-F-06)',
        params: InstanceParams,
        querystring: DeprovisionQuery,
        response: { 202: Operation, 410: Empty, '4xx': OsbError, '5xx': OsbError },
      },
    },
    async (req, reply) => {
      const r = await instances.deprovision(
        req.params.instance_id,
        req.query.accepts_incomplete === true,
      );
      return reply.code(r.status).send(r.body);
    },
  );

  v2.get<InstanceRoute & { Querystring: { operation?: string } }>(
    '/service_instances/:instance_id/last_operation',
    {
      schema: {
        ...osbRoute,
        summary: 'Last operation: progress of provision or deprovision (OSB2-F-05)',
        params: InstanceParams,
        querystring: LastOperationQuery,
        response: { 200: LastOperation, 410: Empty, '4xx': OsbError, '5xx': OsbError },
      },
    },
    async (req, reply) => {
      // OSB2-F-07: how long the platform should wait before polling again.
      reply.header('Retry-After', String(config.retryAfterSeconds));
      const r = await instances.lastOperation(req.params.instance_id, req.query.operation);
      return reply.code(r.status).send(r.body);
    },
  );

  v2.patch<InstanceRoute>(
    '/service_instances/:instance_id',
    {
      schema: {
        ...osbRoute,
        summary: 'Update: not supported (OSB2-F-08)',
        params: InstanceParams,
        response: { 422: OsbError },
      },
    },
    async () => {
      throw new OsbFailure(
        422,
        'Updates are not supported: plan and parameters of a cluster cannot change. ' +
          'Create a new service instance instead.',
      );
    },
  );
}
