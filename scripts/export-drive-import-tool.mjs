import {mkdir,copyFile} from 'node:fs/promises';
// Keep one editable source. Both deployment builds deliver the identical,
// dependency-free manifest utility as a download for the private admin panel.
await mkdir('dist/client/downloads',{recursive:true});
await copyFile('scripts/create-drive-manifests.mjs','dist/client/downloads/create-lingying-drive-manifests.mjs');
