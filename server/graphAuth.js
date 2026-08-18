import 'dotenv/config';
import { createPca, GRAPH_SCOPES } from './graphTokenCache.js';

// Egyszeri, kézi bejelentkeztető script. Futtasd: `node graphAuth.js`
// A megjelenő kóddal és linkkel jelentkezz be a saját Microsoft-fiókoddal.
// Utána a program a jövőben ezt a cache-elt (frissíthető) tokent használja,
// admin jóváhagyás vagy ismételt bejelentkezés nélkül.

const clientId = process.env.AZURE_CLIENT_ID;
const tenantId = process.env.AZURE_TENANT_ID;

if (!clientId || !tenantId) {
  console.error('Hiányzik az AZURE_CLIENT_ID vagy AZURE_TENANT_ID a .env-ből!');
  process.exit(1);
}

const pca = createPca({ clientId, tenantId });

const deviceCodeRequest = {
  deviceCodeCallback: (response) => {
    console.log('\n--- Bejelentkezés szükséges ---');
    console.log(response.message);
    console.log('-------------------------------\n');
  },
  scopes: GRAPH_SCOPES,
};

try {
  const result = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
  console.log('Sikeres bejelentkezés:', result.account.username);
  console.log('A token cache elmentve. Mostantól a szerver automatikusan frissíti a hozzáférést.');
  process.exit(0);
} catch (err) {
  console.error('Bejelentkezési hiba:', err.message || err);
  process.exit(1);
}
