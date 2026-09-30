import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import sharp from 'sharp';

const root = join(process.cwd(), 'examples/vertical-basic');
const assets = join(root, 'assets');
await mkdir(assets, {recursive: true});

const card = (title: string, subtitle: string, start: string, end: string) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${start}"/>
      <stop offset="1" stop-color="${end}"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="880" cy="260" r="190" fill="#ffffff" opacity="0.12"/>
  <circle cx="170" cy="1550" r="280" fill="#ffffff" opacity="0.08"/>
  <text x="80" y="790" fill="#fff" font-size="96" font-family="sans-serif" font-weight="700">${title}</text>
  <text x="84" y="900" fill="#fff" opacity="0.86" font-size="44" font-family="sans-serif">${subtitle}</text>
  <rect x="84" y="960" width="180" height="10" rx="5" fill="#fff" opacity="0.8"/>
</svg>`;

await Promise.all([
  sharp(Buffer.from(card('Portable', 'channel A · video 001', '#172554', '#0f766e')))
    .png()
    .toFile(join(assets, 'shot-001.png')),
  sharp(Buffer.from(card('Deterministic', 'Remotion rough cut', '#7c2d12', '#a16207')))
    .png()
    .toFile(join(assets, 'shot-002.png')),
]);

const sampleRate = 48_000;
const durationSeconds = 3;
const samples = sampleRate * durationSeconds;
const dataSize = samples * 2;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataSize, 40);
for (let index = 0; index < samples; index += 1) {
  const envelope = Math.min(1, index / 2_400, (samples - index) / 2_400);
  const value = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 1_200 * envelope);
  wav.writeInt16LE(value, 44 + index * 2);
}
await writeFile(join(root, 'narration.wav'), wav);

console.log(`Example assets written to ${root}`);
