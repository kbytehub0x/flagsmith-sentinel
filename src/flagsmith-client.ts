import { config } from './config.js';

export interface FeatureFlag {
  id: string | number;
  name: string;
  description: string;
  type: 'FLAG' | 'CONFIG' | 'MULTIVARIATE';
  default_enabled: boolean;
  initial_value?: string | number | boolean;
  created_date: string;
  tags?: string[];
  // Environment specific states
  state?: {
    enabled: boolean;
    value?: string | number | boolean | null;
    multivariate_options?: Array<{
      id: number;
      percentage_allocation: number;
      string_value: string;
    }>;
  };
  // Metadata for AI & Lifecycle
  lifecycle_status?: 'ACTIVE' | 'ROLLING_OUT' | 'STALE_100_PERCENT' | 'DEPRECATED';
  days_active?: number;
}

export interface StaleFlagAuditResult {
  flag: FeatureFlag;
  reason: string;
  recommendation: 'REMOVE_AND_KEEP_ENABLED' | 'REMOVE_AND_KEEP_DISABLED' | 'ARCHIVE_FLAG' | 'LEAVE_ACTIVE';
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class FlagsmithClient {
  private inMemoryFlags: Map<string, FeatureFlag> = new Map();

  constructor() {
    this.seedMockData();
  }

  private seedMockData() {
    const mockFlags: FeatureFlag[] = [
      {
        id: 1,
        name: 'stale_legacy_auth',
        description: 'Old session token validation logic (fully migrated 90 days ago)',
        type: 'FLAG',
        default_enabled: true,
        created_date: '2025-11-01T00:00:00Z',
        tags: ['security', 'auth', 'legacy'],
        state: { enabled: true, value: null },
        lifecycle_status: 'STALE_100_PERCENT',
        days_active: 90,
      },
      {
        id: 2,
        name: 'new_pricing_v2',
        description: 'Multivariate A/B experiment for annual vs monthly discount tiers',
        type: 'MULTIVARIATE',
        default_enabled: true,
        created_date: '2026-11-15T00:00:00Z',
        tags: ['growth', 'monetization'],
        state: {
          enabled: true,
          value: 'tier_b_annual_focus',
          multivariate_options: [
            { id: 201, percentage_allocation: 50, string_value: 'tier_a_monthly_focus' },
            { id: 202, percentage_allocation: 50, string_value: 'tier_b_annual_focus' },
          ],
        },
        lifecycle_status: 'ROLLING_OUT',
        days_active: 10,
      },
      {
        id: 3,
        name: 'ai_smart_search',
        description: 'Vector-assisted semantic search bar in top navigation',
        type: 'FLAG',
        default_enabled: false,
        created_date: '2026-11-20T00:00:00Z',
        tags: ['ai', 'search', 'beta'],
        state: { enabled: false, value: null },
        lifecycle_status: 'ACTIVE',
        days_active: 4,
      },
      {
        id: 4,
        name: 'fast_checkout_stripe',
        description: 'One-click Express Checkout with Apple Pay & Google Pay',
        type: 'FLAG',
        default_enabled: true,
        created_date: '2026-08-10T00:00:00Z',
        tags: ['checkout', 'payments'],
        state: { enabled: true, value: null },
        lifecycle_status: 'STALE_100_PERCENT',
        days_active: 105,
      },
    ];

    for (const flag of mockFlags) {
      this.inMemoryFlags.set(flag.name, flag);
    }
  }

  async listFlags(): Promise<FeatureFlag[]> {
    if (!config.isMockMode && config.apiKey) {
      try {
        const response = await fetch(`${config.apiUrl}/projects/${config.projectId}/features/`, {
          headers: {
            Authorization: `Token ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          return data.results || data;
        }
      } catch (err) {
        console.warn('[FlagsmithClient] Failed to fetch from cloud API, falling back to mock store:', err);
      }
    }
    return Array.from(this.inMemoryFlags.values());
  }

  async getFlag(name: string): Promise<FeatureFlag | null> {
    const flags = await this.listFlags();
    return flags.find((f) => f.name === name) || this.inMemoryFlags.get(name) || null;
  }

  async createFlag(params: {
    name: string;
    description: string;
    default_enabled?: boolean;
    type?: 'FLAG' | 'CONFIG' | 'MULTIVARIATE';
    tags?: string[];
  }): Promise<FeatureFlag> {
    if (!config.isMockMode && config.apiKey) {
      try {
        const response = await fetch(`${config.apiUrl}/projects/${config.projectId}/features/`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: params.name,
            description: params.description,
            default_enabled: params.default_enabled ?? false,
            type: params.type || 'FLAG',
            tags: params.tags || [],
          }),
        });
        if (response.ok) {
          return (await response.json()) as FeatureFlag;
        }
      } catch (err) {
        console.warn('[FlagsmithClient] Failed cloud create, updating local store:', err);
      }
    }

    const newFlag: FeatureFlag = {
      id: Date.now(),
      name: params.name,
      description: params.description,
      type: params.type || 'FLAG',
      default_enabled: params.default_enabled ?? false,
      created_date: new Date().toISOString(),
      tags: params.tags || ['ai-provisioned'],
      state: {
        enabled: params.default_enabled ?? false,
      },
      lifecycle_status: 'ACTIVE',
      days_active: 1,
    };

    this.inMemoryFlags.set(newFlag.name, newFlag);
    return newFlag;
  }

  async toggleFlag(name: string, enabled: boolean): Promise<FeatureFlag> {
    const flag = await this.getFlag(name);
    if (!flag) {
      throw new Error(`Flag '${name}' not found.`);
    }

    flag.state = {
      ...flag.state,
      enabled,
    };
    flag.default_enabled = enabled;

    if (!config.isMockMode && config.apiKey && config.environmentKey) {
      try {
        // Toggle in Flagsmith environment
        await fetch(`${config.apiUrl}/environments/${config.environmentKey}/feature-states/`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            feature: flag.id,
            enabled,
          }),
        });
      } catch (err) {
        console.warn('[FlagsmithClient] Remote toggle failed, state saved locally:', err);
      }
    }

    this.inMemoryFlags.set(name, flag);
    return flag;
  }

  async auditStaleFlags(): Promise<StaleFlagAuditResult[]> {
    const flags = await this.listFlags();
    const results: StaleFlagAuditResult[] = [];

    for (const flag of flags) {
      const isEnabled = flag.state?.enabled ?? flag.default_enabled;
      const days = flag.days_active || 30;

      if (isEnabled && days >= 60) {
        results.push({
          flag,
          reason: `Flag '${flag.name}' has been 100% ENABLED for ${days} days with no state changes. Experiment has concluded.`,
          recommendation: 'REMOVE_AND_KEEP_ENABLED',
          risk_level: 'LOW',
        });
      } else if (!isEnabled && days >= 60) {
        results.push({
          flag,
          reason: `Flag '${flag.name}' has been DISABLED for ${days} days. Abandoned feature or losing experiment branch.`,
          recommendation: 'REMOVE_AND_KEEP_DISABLED',
          risk_level: 'LOW',
        });
      } else if (flag.lifecycle_status === 'STALE_100_PERCENT') {
        results.push({
          flag,
          reason: `Flag '${flag.name}' marked as STALE in Flagsmith.`,
          recommendation: isEnabled ? 'REMOVE_AND_KEEP_ENABLED' : 'REMOVE_AND_KEEP_DISABLED',
          risk_level: 'LOW',
        });
      }
    }

    return results;
  }
}

export const flagsmithClient = new FlagsmithClient();
