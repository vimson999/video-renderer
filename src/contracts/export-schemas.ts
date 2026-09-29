import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

import {ManifestSchema, TimelineSchema} from './schema.js';

const serialize = (schema: object): string => `${JSON.stringify(schema, null, 2)}\n`;

export const writeJsonSchemas = async (targetDir: string): Promise<void> => {
  await mkdir(targetDir, {recursive: true});
  await Promise.all([
    writeFile(
      resolve(targetDir, 'render-package.schema.json'),
      serialize(ManifestSchema),
    ),
    writeFile(
      resolve(targetDir, 'timeline.schema.json'),
      serialize(TimelineSchema),
    ),
  ]);
};

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await writeJsonSchemas(resolve('contracts'));
}
