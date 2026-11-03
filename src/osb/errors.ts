import type { FastifyReply } from 'fastify';

/** Error body of the OSB API ("Service Broker Errors"). */
export interface OsbErrorBody {
  error?: string;
  description: string;
}

export function sendOsbError(
  reply: FastifyReply,
  status: number,
  description: string,
  error?: string,
): FastifyReply {
  const body: OsbErrorBody = error ? { error, description } : { description };
  return reply.code(status).send(body);
}
