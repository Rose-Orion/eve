/**
 * Resend integration — transactional email delivery.
 */

import { getConfig } from '../config/index.js';

const RESEND_API = 'https://api.resend.com';

export interface EmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface EmailResult {
  id: string;
  success: boolean;
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const config = getConfig();
  const res = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RESEND_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await res.json() as { id?: string };
  return { id: data.id ?? '', success: res.ok };
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${RESEND_API}/domains`, {
      headers: { 'Authorization': `Bearer ${getConfig().RESEND_API_KEY ?? ''}` },
    });
    return res.ok;
  } catch { return false; }
}
