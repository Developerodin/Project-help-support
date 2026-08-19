import catchAsync from '../../platform/catchAsync.js';
import { ApiError } from '../../platform/errors.js';
import User from '../users/user.model.js';
import * as authService from './auth.service.js';

export const REFRESH_COOKIE = 'prowplus_refreshToken';
export const IMPERSONATION_ADMIN_COOKIE = 'prowplus_impersonation_admin';

function refreshCookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'strict',
    domain: config.cookie.domain,
    path: '/v1/auth',
    expires: expiresAt,
  };
}

const requestMeta = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

async function impersonationPayload(impersonatedBy) {
  if (!impersonatedBy) return null;
  const admin = await User.findById(impersonatedBy).select('name email');
  return {
    by: impersonatedBy.toString(),
    byName: admin?.name || admin?.email || 'Admin',
  };
}

export const login = (config) => catchAsync(async (req, res) => {
  const result = await authService.login(
    req.body.email, req.body.password, config, requestMeta(req),
  );
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config, result.refreshExpiresAt));
  res.status(200).json({ user: result.user, accessToken: result.accessToken });
});

export const refresh = (config) => catchAsync(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  const result = await authService.refresh(presented, config, requestMeta(req));
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config, result.refreshExpiresAt));
  const body = { user: result.user, accessToken: result.accessToken };
  const impersonation = await impersonationPayload(result.impersonatedBy);
  if (impersonation) body.impersonation = impersonation;
  res.status(200).json(body);
});

export const logout = (config) => catchAsync(async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  const { expires, ...clearOptions } = refreshCookieOptions(config, new Date(0));
  res.clearCookie(REFRESH_COOKIE, clearOptions);
  res.status(204).send();
});

export const me = catchAsync(async (req, res) => {
  const body = { user: req.user.toJSON() };
  if (req.impersonation) {
    body.impersonation = await impersonationPayload(req.impersonation.by);
  }
  res.status(200).json(body);
});

export const previewInvite = catchAsync(async (req, res) => {
  res.status(200).json(await authService.previewInvite(req.body.token));
});

export const acceptInvite = catchAsync(async (req, res) => {
  const user = await authService.acceptInvite(req.body.token, req.body.name, req.body.password);
  res.status(200).json({ user });
});

/**
 * Identical response whether or not the email exists. Anything else — a
 * different status, a different body — turns this endpoint into an
 * account-existence oracle.
 */
export const forgotPassword = (deliver) => catchAsync(async (req, res) => {
  const result = await authService.requestPasswordReset(req.body.email);
  if (result && deliver) await deliver(result);
  res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
});

export const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.status(204).send();
});

export const impersonate = (config) => catchAsync(async (req, res) => {
  if (req.impersonation) {
    throw new ApiError(400, 'ALREADY_IMPERSONATING', 'Stop impersonation before starting a new session');
  }

  const adminRefresh = req.cookies?.[REFRESH_COOKIE];
  if (!adminRefresh) {
    throw new ApiError(400, 'REFRESH_REQUIRED', 'Refresh token required to start impersonation');
  }

  const result = await authService.impersonate(
    req.user, req.params.id, adminRefresh, config, requestMeta(req),
  );

  const adminCookieExpiry = new Date(Date.now() + config.jwt.refreshExpirationDays * 86400000);
  res.cookie(
    IMPERSONATION_ADMIN_COOKIE,
    result.adminRefreshToken,
    refreshCookieOptions(config, adminCookieExpiry),
  );
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config, result.refreshExpiresAt));
  res.status(200).json({
    user: result.user,
    accessToken: result.accessToken,
    impersonation: result.impersonation,
  });
});

export const stopImpersonation = (config) => catchAsync(async (req, res) => {
  if (!req.impersonation) {
    return res.status(200).json({ user: req.user.toJSON() });
  }

  const targetRefresh = req.cookies?.[REFRESH_COOKIE];
  const adminRefresh = req.cookies?.[IMPERSONATION_ADMIN_COOKIE];
  const result = await authService.stopImpersonation(
    targetRefresh, adminRefresh, config, requestMeta(req),
  );

  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(config, result.refreshExpiresAt));
  const { expires, ...clearOptions } = refreshCookieOptions(config, new Date(0));
  res.clearCookie(IMPERSONATION_ADMIN_COOKIE, clearOptions);
  res.status(200).json({ user: result.user, accessToken: result.accessToken });
});
