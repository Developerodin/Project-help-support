import AccessAssignment from '../access/accessAssignment.model.js';
import { activeNotExpiredFilter } from '../access/accessAssignment.queries.js';

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * A brand name is admin-entered free text that ends up inside a Subject line
 * and a From display name, and a header ends at the first CR/LF: a client
 * named "Acme\r\nBcc: someone@else" would otherwise add a recipient to every
 * email that client's people receive. Stripped once here, at the point the
 * name is built, so no downstream consumer has to remember.
 */
function headerSafe(value) {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Acme" -> "Acme PMS". A name that already says PMS is left alone. */
function brandNameFor(base) {
  return /\bpms\b/i.test(base) ? base : `${base} PMS`;
}

function brandingFor(base, logoKey, config) {
  const name = headerSafe(base);
  if (!name) return null;
  const branding = { brandName: brandNameFor(name) };
  const key = optionalString(logoKey);
  if (config?.features?.attachments && key) branding.brandLogoKey = key;
  return branding;
}

/** Branding for a populated Client doc, or null when it has no name. */
export function clientBranding(client, config) {
  return brandingFor(optionalString(client?.name), client?.logoKey, config);
}

/**
 * Branding for the client that owns a ticket's project. `project.brand` is the
 * legacy name carrier for projects predating the Client entity; the logo only
 * ever comes from the Client record.
 */
export function ticketBranding(ticket, config) {
  const project = ticket?.project && typeof ticket.project === 'object' ? ticket.project : null;
  const client = project?.client && typeof project.client === 'object' ? project.client : null;
  const base = optionalString(client?.name) || optionalString(project?.brand);
  return brandingFor(base, client?.logoKey, config);
}

/**
 * The client a person belongs to, resolved from their access assignments —
 * User carries no client field, AccessAssignment does. Internal staff have no
 * client-scoped assignment, so this returns null and the caller falls back to
 * the neutral mark.
 *
 * ponytail: oldest active assignment wins, no tie-break. A person scoped to two
 * clients gets one of them; add a preferred-client field when that is a real
 * account shape rather than a data-entry mistake.
 */
export async function userBranding(userId, config) {
  if (!userId) return null;
  const assignment = await AccessAssignment.findOne(
    activeNotExpiredFilter({ user: userId, client: { $ne: null } }),
  )
    .sort({ createdAt: 1 })
    .populate({ path: 'client', select: 'name logoKey' });
  return clientBranding(assignment?.client, config);
}

/**
 * `"Acme PMS" <no-reply@host>`. The address is fixed by SMTP auth and cannot
 * follow the brand, but the display name can — and that is the part a client
 * reads in their inbox list before opening anything.
 */
export function brandedFrom(config, brandName) {
  const configured = optionalString(config?.email?.from);
  // headerSafe again rather than trusting the caller: this function is
  // exported, and it is the last place the name is still separable from the
  // header it is about to become.
  const brand = headerSafe(optionalString(brandName));
  if (!brand || !configured) return configured;
  const address = configured.match(/<([^>]+)>\s*$/)?.[1].trim() || configured;
  // A " or \ in the display name would escape out of the quoted string and
  // corrupt the header, so they are dropped rather than escaped.
  return `"${brand.replace(/["\\]/g, '')}" <${address}>`;
}
