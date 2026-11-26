import flagsmith from 'flagsmith';

export function renderSearchBar(containerId: string) {
  // ACTIVE EXPERIMENT FLAG: Currently rolling out to beta testers
  const isAiSearchEnabled = flagsmith.hasFeature('ai_smart_search');

  const placeholder = isAiSearchEnabled
    ? '✨ Ask anything with AI Semantic Search...'
    : 'Search documentation...';

  console.log(`[Search] Initialized with placeholder: "${placeholder}" (AI Mode: ${isAiSearchEnabled})`);
  return { placeholder, isAiSearchEnabled };
}
