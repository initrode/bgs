import { buildApp } from './src/app.mjs';
import { PORT } from './src/config.mjs';
import { providers } from './src/registry.mjs';
import { hasEnv } from './src/config.mjs';

const app = await buildApp();

app.listen(PORT, () => {
  console.log(`\n  Homework board  →  http://localhost:${PORT}`);
  console.log(`  API index       →  http://localhost:${PORT}/api\n`);
  for (const p of providers.values()) {
    const ok = !p.credentials.length || hasEnv(p.credentials);
    console.log(`  ${ok ? '✓' : '·'} ${(p.label || p.id).padEnd(16)} ${p.routes.length} route(s)${ok ? '' : `  (needs ${p.credentials.join(', ')})`}`);
  }
  console.log('');
});
