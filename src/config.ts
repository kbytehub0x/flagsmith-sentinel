import dotenv from 'dotenv';
dotenv.config();

export interface FlagsmithConfig {
  apiKey: string;
  environmentKey: string;
  projectId: string;
  apiUrl: string;
  isMockMode: boolean;
}

export const config: FlagsmithConfig = {
  apiKey: process.env.FLAGSMITH_MASTER_API_KEY || '',
  environmentKey: process.env.FLAGSMITH_ENVIRONMENT_KEY || '',
  projectId: process.env.FLAGSMITH_PROJECT_ID || '101',
  apiUrl: process.env.FLAGSMITH_API_URL || 'https://api.flagsmith.com/api/v1',
  isMockMode: !process.env.FLAGSMITH_MASTER_API_KEY,
};
