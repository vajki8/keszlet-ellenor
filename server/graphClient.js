import axios from 'axios';
import { createPca, GRAPH_SCOPES } from './graphTokenCache.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export function createGraphClient({ clientId, tenantId, oneDriveFolder }) {
  const pca = createPca({ clientId, tenantId });
  const folderPath = String(oneDriveFolder || '').replace(/^\/+|\/+$/g, '');

  async function getAccessToken() {
    const accounts = await pca.getTokenCache().getAllAccounts();
    if (!accounts.length) {
      throw new Error(
        'Nincs mentett Microsoft bejelentkezés. Futtasd egyszer kézzel: node server/graphAuth.js'
      );
    }
    const result = await pca.acquireTokenSilent({
      account: accounts[0],
      scopes: GRAPH_SCOPES,
    });
    return result.accessToken;
  }

  async function graphGet(url) {
    const token = await getAccessToken();
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.data;
  }

  // A saját OneDrive-on (Power Automate által idemásolt) mappában megkeresi
  // a legfrissebben módosított, "hansa"-t tartalmazó nevű fájlt, és letölti.
  async function downloadLatestHansaFile() {
    const listUrl = folderPath
      ? `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(folderPath)}:/children`
      : `${GRAPH_BASE}/me/drive/root/children`;

    const data = await graphGet(listUrl);
    const children = data.value || [];

    const candidates = children.filter(c => /hansa/i.test(c.name) && c.file);
    if (!candidates.length) {
      throw new Error(`Nem található "hansa" nevű fájl a OneDrive "${folderPath || '/'}" mappájában.`);
    }
    candidates.sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
    const latest = candidates[0];

    const token = await getAccessToken();
    const resp = await axios.get(`${GRAPH_BASE}/me/drive/items/${latest.id}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });

    return { name: latest.name, modifiedAt: latest.lastModifiedDateTime, buffer: Buffer.from(resp.data) };
  }

  return { downloadLatestHansaFile };
}
