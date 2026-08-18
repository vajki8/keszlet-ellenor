import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PublicClientApplication } from '@azure/msal-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, 'data', '.graph-token-cache.json');

const cachePlugin = {
  beforeCacheAccess: async (cacheContext) => {
    if (fs.existsSync(CACHE_PATH)) {
      cacheContext.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  },
  afterCacheAccess: async (cacheContext) => {
    if (cacheContext.cacheHasChanged) {
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, cacheContext.tokenCache.serialize(), { mode: 0o600 });
    }
  },
};

export function createPca({ clientId, tenantId }) {
  return new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    cache: { cachePlugin },
  });
}

export const GRAPH_SCOPES = ['Files.Read'];
