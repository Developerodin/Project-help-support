import catchAsync from '../../platform/catchAsync.js';
import { dispatchTicketEvent } from '../notifications/dispatch.js';
import * as ticketService from './ticket.service.js';
import * as transitionService from './transition.service.js';
import * as commentService from './comment.service.js';
import * as attachmentService from './attachment.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await ticketService.listTickets(req.user, req.query));
});

export const create = (config) => catchAsync(async (req, res) => {
  const ticket = await ticketService.createTicket(req.user, req.body);
  res.status(201).json(ticket);

  // After the response. A notification failure must never turn a successful
  // create into a 500 the user reads as "the ticket was not filed".
  const doc = await ticketService.resolveTicketDoc(ticket.id);
  await dispatchTicketEvent({
    event: { type: 'TICKET_CREATED', requestId: req.id },
    ticket: doc, actor: req.user, config,
  });
});

export const get = catchAsync(async (req, res) => {
  res.json(await ticketService.getTicket(req.params.id));
});

export const patch = catchAsync(async (req, res) => {
  res.json(await ticketService.patchTicket(req.user, req.params.id, req.body));
});

export const assign = (config) => catchAsync(async (req, res) => {
  const ticket = await ticketService.assignTicket(req.user, req.params.id, req.body);
  res.json(ticket);

  const doc = await ticketService.resolveTicketDoc(ticket.id);
  await dispatchTicketEvent({
    event: { type: 'TICKET_ASSIGNED', requestId: req.id },
    ticket: doc, actor: req.user, config,
  });
});

export const watch = catchAsync(async (req, res) => {
  res.json(await ticketService.watchTicket(req.user, req.params.id));
});

export const unwatch = catchAsync(async (req, res) => {
  res.json(await ticketService.unwatchTicket(req.user, req.params.id));
});

export const setBlocked = catchAsync(async (req, res) => {
  res.json(await ticketService.setBlocked(req.user, req.params.id, req.body));
});

export const clearBlocked = catchAsync(async (req, res) => {
  res.json(await ticketService.clearBlocked(req.user, req.params.id, req.body));
});

export const remove = catchAsync(async (req, res) => {
  res.json(await ticketService.deleteTicket(req.params.id));
});

export const bulk = catchAsync(async (req, res) => {
  res.json(await ticketService.bulkTickets(req.user, req.body));
});

export const transition = (config) => catchAsync(async (req, res) => {
  const { ticket, event } = await transitionService.transitionTicket(
    req.user, req.params.id, req.body,
  );
  res.json(ticket);

  const doc = await ticketService.resolveTicketDoc(ticket.id);
  await dispatchTicketEvent({
    event: { ...event, requestId: req.id }, ticket: doc, actor: req.user, config,
  });
});

export const addComment = (config) => catchAsync(async (req, res) => {
  const { comment, created, event } = await commentService.addComment(
    req.user, req.params.id, req.body,
  );
  res.status(created ? 201 : 200).json(comment);

  if (!created) return;   // a replay notifies nobody a second time
  const doc = await ticketService.resolveTicketDoc(req.params.id);
  await dispatchTicketEvent({
    event: { ...event, requestId: req.id }, ticket: doc, actor: req.user, config,
  });
});

export const editComment = catchAsync(async (req, res) => {
  res.json(await commentService.editComment(
    req.user, req.params.id, req.params.commentId, req.body,
  ));
});

export const deleteComment = catchAsync(async (req, res) => {
  res.json(await commentService.deleteComment(req.user, req.params.id, req.params.commentId));
});

export const reactToComment = catchAsync(async (req, res) => {
  res.json(await commentService.toggleReaction(
    req.user, req.params.id, req.params.commentId, req.body.emoji,
  ));
});

export const addAttachments = (config) => catchAsync(async (req, res) => {
  const added = await attachmentService.addAttachments(
    req.user, req.params.id, req.files || [], config, { clientRef: req.body?.clientRef },
  );
  res.status(201).json(added);
});

export const removeAttachment = (config) => catchAsync(async (req, res) => {
  res.json(await attachmentService.removeAttachment(
    req.user, req.params.id, req.params.attachmentId, config,
  ));
});

export const downloadAttachment = (config) => catchAsync(async (req, res) => {
  const url = await attachmentService.downloadUrl(
    req.user, req.params.id, req.params.attachmentId, config,
  );
  // 302 to a short-lived URL that was minted only because the line above
  // returned rather than threw.
  res.redirect(302, url);
});