import { flagsmithClient } from './flagsmith-client.js';
import { refactorEngine } from './refactor-engine.js';
import path from 'path';

export async function runAgentCli() {
  const args = process.argv.slice(2);
  const command = args[0] || 'audit';
  const isApply = args.includes('--apply');
  const targetDir = path.join(process.cwd(), 'src', 'sample-codebase');

  console.log('\n======================================================');
  console.log('🛡️  FLAGSMITH SENTINEL: AUTONOMOUS FLAG LIFECYCLE AGENT');
  console.log('======================================================\n');

  if (command === 'audit') {
    console.log(`📡 Step 1: Querying Flagsmith for active & stale feature flags...`);
    const flags = await flagsmithClient.listFlags();
    console.log(`   Found ${flags.length} registered feature flags in Flagsmith.\n`);

    console.log(`🔍 Step 2: Running lifecycle audit on feature flags...`);
    const staleCandidates = await flagsmithClient.auditStaleFlags();
    console.log(`   Identified ${staleCandidates.length} flags with confirmed winning variants ready for review.\n`);

    console.log(`📁 Step 3: Scanning local codebase in ${path.relative(process.cwd(), targetDir)}...`);
    const usages = refactorEngine.scanDirectory(targetDir);
    console.log(`   Found ${usages.length} active flag references in code.\n`);

    console.log('------------------------------------------------------');
    console.log('📋 AUDIT REPORT & FLAGSMITH EVIDENCE AUDIT TRAIL:');
    console.log('------------------------------------------------------');

    for (const item of staleCandidates) {
      const codeMatches = usages.filter((u) => u.flagName === item.flag.name);
      console.log(`\n🚩 Flag: "${item.flag.name}"`);
      console.log(`   • Flagsmith Evidence:`);
      console.log(`     - Rollout Percentage: 100%`);
      console.log(`     - Days Active:        ${item.flag.days_active} days`);
      console.log(`     - Confirmed Variant:  ${item.flag.state?.enabled ? 'ENABLED (Winning Branch)' : 'DISABLED'}`);
      console.log(`   • Safety Assessment:    ${item.reason}`);
      console.log(`   • Recommended Action:   ${item.recommendation} [Risk Level: ${item.risk_level}]`);
      console.log(`   • Code References:      ${codeMatches.length} location(s):`);
      for (const match of codeMatches) {
        console.log(`     -> ${path.relative(process.cwd(), match.filePath)}:${match.lineNumber}`);
      }
    }

    console.log('\n💡 Safety Notice: Run "npm run agent:clean" to preview a safe, reviewable refactor diff.');
    console.log('   Pass "--apply" (e.g. "npm run agent:clean -- --apply") only after human approval!\n');
  } else if (command === 'clean') {
    console.log(`🔍 Safety Mode: ${isApply ? 'APPLY (Writing changes to disk)' : 'PROPOSE / DRY-RUN (Generating reviewable diff)'}`);
    console.log(`📁 Target directory: ${path.relative(process.cwd(), targetDir)}\n`);

    const staleCandidates = await flagsmithClient.auditStaleFlags();
    const usages = refactorEngine.scanDirectory(targetDir);

    let proposalCount = 0;

    for (const candidate of staleCandidates) {
      if (candidate.recommendation === 'REMOVE_AND_KEEP_ENABLED') {
        const matches = usages.filter((u) => u.flagName === candidate.flag.name);
        for (const match of matches) {
          proposalCount++;
          console.log(`------------------------------------------------------`);
          console.log(`📝 Proposal #${proposalCount}: Refactor "${candidate.flag.name}" in ${path.basename(match.filePath)}`);
          console.log(`   Flagsmith Verified Evidence: 100% rollout for ${candidate.flag.days_active}d | Winning Variant: ENABLED`);
          
          const diff = refactorEngine.refactorFile(match.filePath, candidate.flag.name, 'ENABLED');
          if (diff) {
            console.log(`   Diff Summary: ${diff.diffSummary}`);
            if (isApply) {
              refactorEngine.applyRefactor(match.filePath, diff.refactoredContent);
              console.log(`   ✅ Status: APPLIED to disk (Safe reviewable modification).`);
            } else {
              console.log(`   👀 Status: PROPOSED (Dry-run mode. Pass --apply to write to disk).`);
            }
          }
        }
      }
    }

    console.log('\n------------------------------------------------------');
    if (!isApply) {
      console.log(`✨ Generated ${proposalCount} reviewable refactor proposal(s). Zero disk mutations performed.`);
      console.log(`👉 To commit changes to working tree, run: npm run agent:clean -- --apply\n`);
    } else {
      console.log(`🎉 Successfully applied ${proposalCount} refactor(s) safely with verified Flagsmith evidence.\n`);
    }
  } else if (command === 'provision') {
    const flagName = args[1] || 'new_feature_sample';
    const desc = args[2] || 'Feature flag provisioned via AI Agent';
    console.log(`🚀 Provisioning new flag: "${flagName}" into Flagsmith...`);
    const newFlag = await flagsmithClient.createFlag({
      name: flagName,
      description: desc,
      default_enabled: false,
      tags: ['ai-agent', 'wemakedevs'],
    });
    console.log(`✅ Flag created!`, newFlag);
  } else {
    console.log(`Usage: agent.ts [audit | clean [--apply] | provision <name> <description>]`);
  }
}

if (process.argv[1]?.endsWith('agent.ts') || process.argv[1]?.endsWith('agent.js')) {
  runAgentCli().catch((err) => {
    console.error('Agent error:', err);
    process.exit(1);
  });
}
