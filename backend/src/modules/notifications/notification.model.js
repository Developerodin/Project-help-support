import mongoose from 'mongoose';
import { NOTIFICATION_EVENTS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // ONE type, keyed by event — which is what lets notificationPrefs gate per event.
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', index: true },
    // Copied from the ticket at creation so the per-project list and unread
    // count filter on the row itself instead of resolving the project's tickets.
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    title: { type: String, required: true },
    body: { type: String },
    link: { type: String },
    readAt: { type: Date, default: null },
    // Routine updates on one ticket fold into the reader's one unread row for
    // it: `count` is how many it holds, `activityAt` when the latest landed.
    count: { type: Number, default: 1 },
    activityAt: { type: Date, required: true, default: Date.now },
    // Addressed to this person (a mention, an assignment to them, a comment on
    // a ticket they raised). Always its own row, never folded.
    forYou: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// The list sorts by activityAt: a folded row moves up when it gains an update.
notificationSchema.index({ user: 1, activityAt: -1 });
notificationSchema.index({ user: 1, readAt: 1, activityAt: -1 });
notificationSchema.index({ user: 1, forYou: 1, readAt: 1, activityAt: -1 });
notificationSchema.index({ user: 1, project: 1, readAt: 1, activityAt: -1 });
// Read rows expire 90 days after they were read. Mongo's TTL monitor skips a
// null or missing date, so an unread row is never expired, however old.
notificationSchema.index({ readAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

notificationSchema.plugin(toJSON);

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
