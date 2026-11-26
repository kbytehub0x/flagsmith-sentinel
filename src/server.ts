import express from 'express';
import path from 'path';
import { flagsmithClient } from './flagsmith-client.js';
import { refactorEngine } from './refactor-engine.js';
import { config } from './config.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// API: Get all flags
app.get('/api/flags', async (req, res) => {
  const flags = await flagsmithClient.listFlags();
  res.json({ flags, isMockMode: config.isMockMode });
});

// API: Toggle flag
app.post('/api/flags/toggle', async (req, res) => {
  const { name, enabled } = req.body;
  try {
    const updated = await flagsmithClient.toggleFlag(name, enabled);
    res.json({ success: true, flag: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// API: Create flag
app.post('/api/flags/create', async (req, res) => {
  const { name, description, default_enabled, tags } = req.body;
  try {
    const created = await flagsmithClient.createFlag({
      name,
      description,
      default_enabled,
      tags,
    });
    res.json({ success: true, flag: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// API: Audit stale flags
app.get('/api/audit', async (req, res) => {
  const targetDir = path.join(process.cwd(), 'src', 'sample-codebase');
  const audits = await flagsmithClient.auditStaleFlags();
  const usages = refactorEngine.scanDirectory(targetDir);

  const enriched = audits.map((a) => ({
    ...a,
    codeMatches: usages.filter((u) => u.flagName === a.flag.name),
  }));

  res.json({ audits: enriched, totalUsages: usages.length });
});

// API: Preview or apply refactor
app.post('/api/refactor', (req, res) => {
  const { filePath, flagName, keepBranch, apply } = req.body;
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  const diff = refactorEngine.refactorFile(fullPath, flagName, keepBranch || 'ENABLED');
  if (!diff) {
    return res.status(400).json({ error: `Flag '${flagName}' not found in ${filePath}` });
  }

  if (apply) {
    refactorEngine.applyRefactor(fullPath, diff.refactoredContent);
  }

  res.json({ success: true, diff, applied: Boolean(apply) });
});

// API: Run sample code evaluation to test live behavior
app.get('/api/test-sample-checkout', async (req, res) => {
  const flag = await flagsmithClient.getFlag('fast_checkout_stripe');
  const isStripeEnabled = flag?.state?.enabled ?? flag?.default_enabled;

  res.json({
    orderId: 'ORD-9824',
    amount: 149.0,
    currency: 'USD',
    executedRoute: isStripeEnabled ? 'STRIPE_EXPRESS_APPLE_PAY' : 'LEGACY_REDIRECT_GATEWAY',
    latencyMs: isStripeEnabled ? 42 : 480,
    flagEvaluated: 'fast_checkout_stripe',
    flagState: isStripeEnabled,
  });
});

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Flagsmith Sentinel Playground running at:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer();
}
