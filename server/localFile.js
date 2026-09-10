import fs from 'fs';
import path from 'path';

// A Windows gépen a Teams "Files" fülén a "Sync" gombbal helyben
// szinkronizált csatorna-mappából olvassa be a legfrissebb "hansa" nevű
// fájlt. Nincs szükség Graph API-ra vagy Azure app regisztrációra — a
// szinkronizált mappa a fájlrendszeren keresztül simán elérhető.
export function createLocalFileClient({ folder }) {
  async function downloadLatestHansaFile() {
    if (!folder) {
      throw new Error('Nincs beállítva LOCAL_HANSA_FOLDER a .env-ben.');
    }
    if (!fs.existsSync(folder)) {
      throw new Error(`A megadott mappa nem található: ${folder}`);
    }

    const entries = fs.readdirSync(folder, { withFileTypes: true });
    const candidates = entries
      .filter(e => e.isFile() && /hansa/i.test(e.name))
      .map(e => {
        const fullPath = path.join(folder, e.name);
        const stat = fs.statSync(fullPath);
        return { name: e.name, fullPath, mtime: stat.mtime };
      });

    if (!candidates.length) {
      throw new Error(`Nem található "hansa" nevű fájl a mappában: ${folder}`);
    }

    candidates.sort((a, b) => b.mtime - a.mtime);
    const latest = candidates[0];
    const buffer = fs.readFileSync(latest.fullPath);

    return { name: latest.name, modifiedAt: latest.mtime.toISOString(), buffer };
  }

  return { downloadLatestHansaFile };
}
