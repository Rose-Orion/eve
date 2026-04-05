/**
 * Standalone fal.ai test — run on the Mac Mini to verify the API key works
 * and images can be generated + downloaded.
 *
 * Usage: npx tsx test-fal.ts
 */

import { fal } from '@fal-ai/client';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';

config(); // Load .env

const FAL_KEY = process.env['FAL_KEY'];
if (!FAL_KEY) {
  console.error('❌ FAL_KEY not found in environment. Check your .env file.');
  process.exit(1);
}

console.log(`✅ FAL_KEY found (${FAL_KEY.length} chars, starts with ${FAL_KEY.slice(0, 8)}...)`);

fal.config({ credentials: FAL_KEY });

const TESTS = [
  {
    name: 'FLUX Dev (photorealism)',
    model: 'fal-ai/flux/dev',
    input: {
      prompt: 'A modern minimalist logo for a tech startup called "Orion", clean vector style, white background',
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
    },
  },
  {
    name: 'Ideogram V2 (text-in-image)',
    model: 'fal-ai/ideogram/v2',
    input: {
      prompt: 'A social media post graphic with the text "LAUNCH DAY" in bold modern typography, gradient background blue to purple',
      image_size: { width: 1080, height: 1080 },
      num_images: 1,
    },
  },
  {
    name: 'Recraft V3 (vector/logo)',
    model: 'fal-ai/recraft-v3',
    input: {
      prompt: 'A minimalist brand icon, abstract geometric shape, single color, vector style, suitable for app icon',
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
      style: 'vector_illustration',
    },
  },
];

const outDir = join(process.cwd(), 'test-output');
await mkdir(outDir, { recursive: true });

for (const test of TESTS) {
  console.log(`\n--- Testing: ${test.name} (${test.model}) ---`);
  const start = Date.now();

  try {
    const result = await fal.subscribe(test.model, { input: test.input }) as {
      data: { images?: Array<{ url: string }>; seed?: number };
    };

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const images = result.data.images ?? [];

    if (images.length === 0) {
      console.error(`  ❌ No images returned (${elapsed}s)`);
      console.error('  Response:', JSON.stringify(result.data).slice(0, 300));
      continue;
    }

    console.log(`  ✅ ${images.length} image(s) generated in ${elapsed}s`);

    for (let i = 0; i < images.length; i++) {
      const url = images[i]!.url;
      console.log(`  URL: ${url.slice(0, 80)}...`);

      // Download the image
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = url.includes('.png') ? 'png' : 'webp';
        const filename = `test-${test.model.replace(/\//g, '-')}-${i}.${ext}`;
        const filePath = join(outDir, filename);
        await writeFile(filePath, buffer);
        console.log(`  💾 Saved: ${filePath} (${buffer.length} bytes)`);
      } catch (dlErr) {
        console.error(`  ❌ Download failed: ${(dlErr as Error).message}`);
      }
    }
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ FAILED after ${elapsed}s: ${(err as Error).message}`);
    if ((err as { body?: unknown }).body) {
      console.error('  Body:', JSON.stringify((err as { body: unknown }).body).slice(0, 300));
    }
  }
}

console.log('\n=== Test complete ===');
console.log(`Output directory: ${outDir}`);
