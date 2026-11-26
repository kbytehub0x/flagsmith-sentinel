import { flagsmithClient } from '../src/flagsmith-client.js';
import { refactorEngine } from '../src/refactor-engine.js';
import { createMcpServer } from '../src/mcp-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';

async function runTests() {
  console.log('🧪 Running Flagsmith Sentinel Automated Verification Tests...\n');

  // Test 1: Flagsmith Client operations
  console.log('Test 1: Flagsmith Client Listing & Toggling...');
  const flags = await flagsmithClient.listFlags();
  if (flags.length < 3) throw new Error(`Expected at least 3 flags, got ${flags.length}`);
  console.log(`  ✅ Successfully listed ${flags.length} flags.`);

  const toggled = await flagsmithClient.toggleFlag('ai_smart_search', true);
  if (!toggled.state?.enabled) throw new Error('Toggle failed to enable flag');
  console.log(`  ✅ Successfully toggled 'ai_smart_search' to true.`);

  // Test 2: Codebase Scanning
  console.log('\nTest 2: Codebase Scanner...');
  const targetDir = path.join(process.cwd(), 'src', 'sample-codebase');
  const usages = refactorEngine.scanDirectory(targetDir);
  if (usages.length < 2) throw new Error(`Expected at least 2 usages, got ${usages.length}`);
  console.log(`  ✅ Found ${usages.length} flag invocations across sample files.`);

  // Test 3: Stale Flag Audit
  console.log('\nTest 3: Stale Flag Audit Logic...');
  const stale = await flagsmithClient.auditStaleFlags();
  if (stale.length < 1) throw new Error('Expected at least 1 stale flag');
  console.log(`  ✅ Identified ${stale.length} stale flag candidates.`);

  // Test 4: Refactor Engine Preview
  console.log('\nTest 4: AST / Balanced Brace Refactoring...');
  const checkoutPath = path.join(targetDir, 'checkout.ts');
  const diff = refactorEngine.refactorFile(checkoutPath, 'fast_checkout_stripe', 'ENABLED');
  if (!diff || !diff.refactoredContent.includes('stripe_express_v2')) {
    throw new Error('Refactor failed to preserve enabled branch');
  }
  if (diff.refactoredContent.includes('legacy_redirect_v1')) {
    throw new Error('Refactor failed to eliminate disabled branch');
  }
  console.log(`  ✅ Refactor engine cleanly eliminated flag wrapper and legacy branch.`);

  // Test 5: End-to-End Model Context Protocol (MCP) Client <-> Server
  console.log('\nTest 5: Full End-to-End MCP Protocol Handshake...');
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'test-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const toolsResponse = await client.listTools();
  if (toolsResponse.tools.length !== 7) {
    throw new Error(`Expected 7 MCP tools, got ${toolsResponse.tools.length}`);
  }
  console.log(`  ✅ Client queried MCP server: Found ${toolsResponse.tools.length} active tools.`);

  // Test calling a tool through MCP JSON-RPC
  const callResult = (await client.callTool({
    name: 'flagsmith_list_flags',
    arguments: {},
  })) as any;
  if (!callResult.content || callResult.content.length === 0) {
    throw new Error('Failed to execute flagsmith_list_flags via MCP');
  }
  console.log(`  ✅ Successfully executed 'flagsmith_list_flags' via MCP JSON-RPC protocol.`);

  await client.close();
  await server.close();

  console.log('\n🎉 ALL 5/5 SYSTEM & PROTOCOL TESTS PASSED! Ready for submission.');
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
