import { apiFetch } from './client.js';

/** { enabled: false } | { enabled: true, linked: false } | { enabled: true, linked: true, number, linkedAt } */
export const getWhatsappLink = () => apiFetch('/whatsapp/link');

/** A one-time code to send from WhatsApp: { code, expiresAt, businessNumber } */
export const startWhatsappLink = () => apiFetch('/whatsapp/link', { method: 'POST' });

export const unlinkWhatsapp = () => apiFetch('/whatsapp/link', { method: 'DELETE' });
