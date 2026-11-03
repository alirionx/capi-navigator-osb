import { buildApp } from './app.js';
import { createCapiClient } from './capi/client.js';
import { ConfigError, loadConfig, type SecretFileWarning } from './config.js';

const warnings: SecretFileWarning[] = [];
let config;
try {
  config = loadConfig(process.env, { onWarning: (w) => warnings.push(w) });
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  // Structured like the other log lines; names variables, never values.
  console.error(JSON.stringify({ level: 50, time: Date.now(), msg: err.message }));
  process.exit(1);
}

const capi = createCapiClient({
  url: config.capi.url,
  token: config.capi.token,
  timeoutMs: config.capi.timeoutMs,
});
const app = await buildApp({ config, capi });
for (const w of warnings) app.log.warn({ path: w.path }, w.message);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(
  { capiUrl: config.capi.url, connection: config.capi.connection, offering: config.offering.name },
  'broker started',
);
