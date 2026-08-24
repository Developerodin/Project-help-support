import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  ROLES, ROLE_IDS, DEFAULT_NOTIFICATION_PREFS, DEFAULT_TICKET_PREFERENCES, pickPrimaryRole,
} from '@pms/shared';
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
    /** Present only on refresh tokens issued during admin impersonation. */
    impersonatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const consumedTokenSchema = new mongoose.Schema(
  { tokenHash: { type: String, required: true }, consumedAt: { type: Date, default: Date.now } },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator(v) {
          if (this.status === 'active') return typeof v === 'string' && v.trim().length >= 1;
          return true;
        },
        message: 'Name is required for active users',
      },
    },
    email: {
      type: String,
      required: true,
      unique: true,
      // A setter, not a convention: "Admin@x.com", "admin@x.com" and "admin@x.com "
      // must not become three identities.
      set: (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    },
    password: { type: String, required: true, minlength: 8, private: true, select: false },
    role: { type: String, enum: ROLES, default: ROLE_IDS.READ_ONLY, index: true },
    /** All global roles held by this user. Effective permissions = union of roles. */
    roles: {
      type: [{ type: String, enum: ROLES }],
      default: undefined,
      validate: {
        validator(v) {
          return !v || v.length > 0;
        },
        message: 'roles must contain at least one role when set',
      },
    },
    /** Reserved for a future open-intake path. Unused in build 1. */
    kind: { type: String, enum: ['internal', 'reporter'], default: 'internal' },
    status: {
      type: String,
      enum: ['invited', 'active', 'inactive', 'deleted'],
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
    /** Per-user ticket list/board filters and table sort — survives refresh and navigation. */
    ticketPreferences: {
      filters: {
        q: { type: String, trim: true, default: DEFAULT_TICKET_PREFERENCES.filters.q },
        status: { type: String, trim: true, default: DEFAULT_TICKET_PREFERENCES.filters.status },
        priority: { type: String, trim: true, default: DEFAULT_TICKET_PREFERENCES.filters.priority },
        scope: {
          type: String,
          enum: ['all', 'assigned', 'reported', 'unassigned'],
          default: DEFAULT_TICKET_PREFERENCES.filters.scope,
        },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        blocked: { type: Boolean, default: DEFAULT_TICKET_PREFERENCES.filters.blocked },
        overdue: { type: Boolean, default: DEFAULT_TICKET_PREFERENCES.filters.overdue },
        reopened: { type: Boolean, default: DEFAULT_TICKET_PREFERENCES.filters.reopened },
      },
      sort: {
        column: {
          type: String,
          enum: [...['ticketId', 'title', 'status', 'owner', 'inStage', 'estimatedDone'], null],
          default: DEFAULT_TICKET_PREFERENCES.sort.column,
        },
        direction: {
          type: String,
          enum: ['asc', 'desc', null],
          default: DEFAULT_TICKET_PREFERENCES.sort.direction,
        },
      },
      boardMine: { type: Boolean, default: DEFAULT_TICKET_PREFERENCES.boardMine },
      limit: { type: Number, min: 1, max: 100, default: DEFAULT_TICKET_PREFERENCES.limit },
    },
  },
  { timestamps: true },
);

userSchema.plugin(toJSON);

userSchema.pre('save', async function normaliseAndHash(next) {
  if (this.roles?.length) {
    this.roles = [...new Set(this.roles)];
    this.role = pickPrimaryRole(this.roles);
  } else if (this.role) {
    this.roles = [this.role];
  }

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

userSchema.post('init', function hydrateRoles() {
  if (!this.roles?.length && this.role) {
    this.roles = [this.role];
  }
});

userSchema.methods.isPasswordMatch = async function isPasswordMatch(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.statics.findByNormalisedEmail = async function findByNormalisedEmail(email, excludeUserId) {
  const normalised = String(email).trim().toLowerCase();
  return this.findOne({ email: normalised, _id: { $ne: excludeUserId } });
};

userSchema.statics.isEmailTaken = async function isEmailTaken(email, excludeUserId) {
  return !!(await this.findByNormalisedEmail(email, excludeUserId));
};

const User = mongoose.model('User', userSchema);
export default User;
