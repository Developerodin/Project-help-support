'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/shared/lib/utils';

const AttachmentContext = React.createContext(null);

function useAttachmentContext() {
  const ctx = React.useContext(AttachmentContext);
  if (!ctx) {
    throw new Error('Attachment compound components must be rendered within <Attachment>.');
  }
  return ctx;
}

function Attachment({
  className,
  state = 'idle',
  size = 'default',
  orientation = 'horizontal',
  asChild = false,
  children,
  ...props
}) {
  const Comp = asChild ? Slot.Root : 'div';

  return (
    <AttachmentContext.Provider value={{ state, size, orientation }}>
      <Comp
        data-slot="attachment"
        data-state={state}
        data-size={size}
        data-orientation={orientation}
        className={cn('attachment', className)}
        {...props}
      >
        {children}
      </Comp>
    </AttachmentContext.Provider>
  );
}

function AttachmentMedia({
  className,
  variant = 'icon',
  asChild = false,
  children,
  ...props
}) {
  const { size } = useAttachmentContext();
  const Comp = asChild ? Slot.Root : 'div';

  return (
    <Comp
      data-slot="attachment-media"
      data-variant={variant}
      data-size={size}
      className={cn('attachment-media', className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

function AttachmentContent({ className, ...props }) {
  return (
    <div
      data-slot="attachment-content"
      className={cn('attachment-content', className)}
      {...props}
    />
  );
}

function AttachmentTitle({ className, asChild = false, children, ...props }) {
  const { state } = useAttachmentContext();
  const Comp = asChild ? Slot.Root : 'div';
  const shimmer = state === 'uploading' || state === 'processing';

  return (
    <Comp
      data-slot="attachment-title"
      className={cn('attachment-title', shimmer && 'attachment-title--shimmer', className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

function AttachmentDescription({ className, ...props }) {
  const { state } = useAttachmentContext();

  return (
    <div
      data-slot="attachment-description"
      data-state={state}
      className={cn('attachment-description', className)}
      {...props}
    />
  );
}

function AttachmentActions({ className, ...props }) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn('attachment-actions', className)}
      {...props}
    />
  );
}

function AttachmentAction({
  className,
  variant = 'default',
  asChild = false,
  children,
  ...props
}) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      type={asChild ? undefined : 'button'}
      data-slot="attachment-action"
      data-variant={variant}
      className={cn('attachment-action', className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

function AttachmentTrigger({ className, asChild = false, children, ...props }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      type={asChild ? undefined : 'button'}
      data-slot="attachment-trigger"
      className={cn('attachment-trigger', className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

function AttachmentGroup({ className, ...props }) {
  return (
    <div
      data-slot="attachment-group"
      className={cn('attachment-group', className)}
      {...props}
    />
  );
}

function AttachmentList({ className, ...props }) {
  return (
    <ul
      data-slot="attachment-list"
      className={cn('attachment-list', className)}
      {...props}
    />
  );
}

function AttachmentListItem({ className, ...props }) {
  return (
    <li
      data-slot="attachment-list-item"
      className={cn('attachment-list-item', className)}
      {...props}
    />
  );
}

/** Map tab pending queue status to attachment UI state. */
export function attachmentStateFromPending(status) {
  if (status === 'uploading') return 'uploading';
  if (status === 'failed') return 'error';
  if (status === 'ready') return 'idle';
  return 'idle';
}

export {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
  AttachmentGroup,
  AttachmentList,
  AttachmentListItem,
};
