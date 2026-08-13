import mongoose from 'mongoose';
import { NOTIFICATION_EVENTS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // ONE type, keyed by event — which is what lets notificationPrefs gate per event.
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', index: true },
    title: { type: String, required: true },
    body: { type: String },
    link: { type: String },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

notificationSchema.plugin(toJSON);

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
