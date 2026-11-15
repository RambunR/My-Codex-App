import {mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
// Keep one editable source. Both deployment builds deliver the identical,
// dependency-free manifest utility as a download for the private admin panel.
await mkdir('dist/client/downloads',{recursive:true});
await copyFile('scripts/create-drive-manifests.mjs','dist/client/downloads/create-lingying-drive-manifests.mjs');

await build({entryPoints:['scripts/verify-clipweave-export.mjs'],bundle:true,platform:'node',target:'node18',format:'esm',outfile:'dist/client/downloads/verify-clipweave-export.mjs'});
