/**
 * The user of an `X-Broker-API-Originating-Identity` header (OSB0-F-05): `<platform> <base64 JSON>`.
 * Cloud Foundry sends `{"user_id": "…"}`, Kubernetes `{"username": "…"}`. Returns undefined for a
 * missing or malformed header.
 */
export function originatingUser(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const [, encoded] = header.trim().split(/\s+/);
  if (!encoded) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const { user_id: userId, username } = value as Record<string, unknown>;
    if (typeof userId === 'string') return userId;
    if (typeof username === 'string') return username;
  } catch {
    // malformed: not logged
  }
  return undefined;
}
