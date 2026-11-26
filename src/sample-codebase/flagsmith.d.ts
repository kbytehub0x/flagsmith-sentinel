declare module 'flagsmith' {
  interface FlagsmithClient {
    hasFeature(key: string): boolean;
    isFeatureEnabled(key: string): boolean;
    getValue(key: string): any;
  }
  const flagsmith: FlagsmithClient;
  export default flagsmith;
}
