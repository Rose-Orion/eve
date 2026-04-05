/**
 * ElevenLabs API wrapper — voice generation for video narration and audio content.
 */

import { getConfig } from '../config/index.js';
import { withRetry } from './retry.js';
import { checkBudget } from './budget-check.js';

const BASE_URL = 'https://api.elevenlabs.io/v1';

export interface VoiceGenRequest {
  text: string;
  voiceId: string;
  modelId?: string;
  outputFormat?: string;
}

export interface VoiceGenResult {
  audioBuffer: Buffer;
  costCents: number;
  characterCount: number;
}

/**
 * Generate speech from text via ElevenLabs.
 */
export async function generateSpeech(request: VoiceGenRequest, floorId?: string): Promise<VoiceGenResult> {
  const config = getConfig();
  if (!config.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

  // Estimate cost and check budget before making the API call
  const charCount = request.text.length;
  const estimatedCostCents = Math.ceil((charCount / 1000) * 30);
  if (floorId) {
    checkBudget(floorId, estimatedCostCents);
  }

  const response = await withRetry(
    async () => {
      const res = await fetch(`${BASE_URL}/text-to-speech/${request.voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId ?? 'eleven_multilingual_v2',
          output_format: request.outputFormat ?? 'mp3_44100_128',
        }),
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs API error: ${res.status} ${res.statusText}`);
      }
      return res;
    },
    { label: 'ElevenLabs:speech', maxRetries: 2 },
  );

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  return {
    audioBuffer,
    costCents: estimatedCostCents,
    characterCount: charCount,
  };
}

/**
 * List available voices.
 */
export async function listVoices(): Promise<Array<{ voiceId: string; name: string }>> {
  const config = getConfig();
  if (!config.ELEVENLABS_API_KEY) return [];

  const response = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
  });

  if (!response.ok) return [];
  const data = await response.json() as { voices?: Array<{ voice_id: string; name: string }> };

  return (data.voices ?? []).map(v => ({ voiceId: v.voice_id, name: v.name }));
}
