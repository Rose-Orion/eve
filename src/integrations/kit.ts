/**
 * Kit (ConvertKit) integration — marketing email sequences.
 * Handles subscriber management, sequences, and broadcasts.
 */

const KIT_API = 'https://api.convertkit.com/v3';

export interface KitSubscriber {
  id: number;
  email: string;
  firstName: string;
  state: string;
}

export async function addSubscriber(
  apiSecret: string,
  formId: string,
  email: string,
  firstName: string,
): Promise<KitSubscriber | null> {
  try {
    const res = await fetch(`${KIT_API}/forms/${formId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_secret: apiSecret,
        email,
        first_name: firstName,
      }),
    });
    if (!res.ok) {
      console.warn(`[Kit] addSubscriber failed (${res.status})`);
      return null;
    }
    const data = await res.json() as { subscription?: { subscriber?: { id: number; state: string } } };
    return {
      id: data.subscription?.subscriber?.id ?? 0,
      email,
      firstName,
      state: data.subscription?.subscriber?.state ?? 'unknown',
    };
  } catch (err) {
    console.error(`[Kit] addSubscriber error: ${(err as Error).message}`);
    return null;
  }
}

export async function listSequences(apiSecret: string): Promise<Array<{ id: number; name: string }>> {
  try {
    const res = await fetch(`${KIT_API}/sequences?api_secret=${apiSecret}`);
    if (!res.ok) return [];
    const data = await res.json() as { courses?: Array<{ id: number; name: string }> };
    return data.courses ?? [];
  } catch (err) {
    console.error(`[Kit] listSequences error: ${(err as Error).message}`);
    return [];
  }
}

export async function addToSequence(
  apiSecret: string,
  sequenceId: number,
  email: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${KIT_API}/sequences/${sequenceId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_secret: apiSecret, email }),
    });
    return res.ok;
  } catch (err) {
    console.error(`[Kit] addToSequence error: ${(err as Error).message}`);
    return false;
  }
}

export async function checkConnection(apiSecret?: string): Promise<boolean> {
  if (!apiSecret) return false;
  try {
    const res = await fetch(`${KIT_API}/account?api_secret=${apiSecret}`);
    return res.ok;
  } catch { return false; }
}
