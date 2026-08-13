import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, DEFAULT_NOTIFICATION_PREFS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

export const MAX_REFRESH_TOKENS = 10;
const MAX_CONSUMED_TOKENS = 50;
const BCRYPT_ROUNDS = 10;

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },   // sha256 hex — never the raw token
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    userAgent: { type: String, trim: true },
    ip: { type: String, trim: true },
  },
  { _id: false },
);

const consumedTokenSchema = new mongoose.Schema(
  { tokenHash: { type: String, required: true }, consumedAt: { type: Date, default: Date.now } },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      // A setter, not a convention: "Admin@x.com", "admin@x.com" and "admin@x.com "
      // must not become three identities.
      set: (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    },
    password: { type: String, required: true, minlength: 8, private: true, select: false },
    role: { type: String, enum: ROLES, default: 'member', index: true },
    /** Reserved for a future open-intake path. Unused in build 1. */
    kind: { type: String, enum: ['internal', 'reporter'], default: 'internal' },
    status: {
      type: String,
      enum: ['invited', 'active', 'inactive'],
      default: 'invited',
      index: true,
    },
    // sha256 of the raw invite (or reset) token. No TTL index anywhere on this
    // schema — a TTL index here would delete the entire User document, not the token.
    inviteTokenHash: { type: String, private: true, select: false },
    inviteTokenExpiresAt: { type: Date, select: false },
    lastLoginAt: { type: Date },
    refreshTokens: { type: [refreshTokenSchema], default: [], private: true, select: false },
    /**
     * Hashes of refresh tokens already rotated away. Kept so a replay is
     * ATTRIBUTABLE — without it a consumed token hashes to nothing on record and
     * the theft cannot be traced to a user whose sessions must be revoked.
     */
    consumedRefreshTokens: { type: [consumedTokenSchema], default: [], private: true, select: false },
    notificationPrefs: {
      email: {
        type: Map,
        of: Boolean,
        default: () => new Map(Object.entries(DEFAULT_NOTIFICATION_PREFS.email)),
      },
      inApp: {
        type: Map,
        of: Boolean,
        default: () => new Map(Object.entries(DEFAULT_NOTIFICATION_PREFS.inApp)),
      },
    },
  },
  { timestamps: true },
);

userSchema.plugin(toJSON);

userSchema.pre('save', async function normaliseAndHash(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  }
  if (this.refreshTokens?.length > MAX_REFRESH_TOKENS) {
    this.refreshTokens.sort((a, b) => a.createdAt - b.createdAt);
    this.refreshTokens = this.refreshTokens.slice(-MAX_REFRESH_TOKENS);
  }
  if (this.consumedRefreshTokens?.length > MAX_CONSUMED_TOKENS) {
    this.consumedRefreshTokens = this.consumedRefreshTokens.slice(-MAX_CONSUMED_TOKENS);
  }
  next();
});

userSchema.methods.isPasswordMatch = async function isPasswordMatch(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.statics.isEmailTaken = async function isEmailTaken(email, excludeUserId) {
  const normalised = String(email).trim().toLowerCase();
  const found = await this.findOne({ email: normalised, _id: { $ne: excludeUserId } });
  return !!found;
};

const User = mongoose.model('User', userSchema);
export default User;
