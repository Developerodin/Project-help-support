'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/shared/lib/utils';

const BubbleContext = React.createContext({
  variant: 'default',
  align: 'start',
});

function useBubbleContext() {
  const ctx = React.useContext(BubbleContext);
  if (!ctx) {
    throw new Error('Bubble compound components must be rendered within <Bubble>.');
  }
  return ctx;
}

function Bubble({
  className,
  variant = 'default',
  align = 'start',
  asChild = false,
  children,
  ...props
}) {
  const Comp = asChild ? Slot.Root : 'div';

  return (
    <BubbleContext.Provider value={{ variant, align }}>
      <Comp
        data-slot="bubble"
        data-variant={variant}
        data-align={align}
        className={cn('bubble', className)}
        {...props}
      >
        {children}
      </Comp>
    </BubbleContext.Provider>
  );
}

function BubbleContent({ className, ...props }) {
  useBubbleContext();

  return (
    <div
      data-slot="bubble-content"
      className={cn('bubble-content', className)}
      {...props}
    />
  );
}

function BubbleReactions({
  className,
  'aria-label': ariaLabel = 'Reactions',
  ...props
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="bubble-reactions"
      className={cn('bubble-reactions', className)}
      {...props}
    />
  );
}

function BubbleGroup({
  className,
  align = 'start',
  ...props
}) {
  return (
    <div
      data-slot="bubble-group"
      data-align={align}
      className={cn('bubble-group', className)}
      {...props}
    />
  );
}

export {
  Bubble,
  BubbleContent,
  BubbleReactions,
  BubbleGroup,
};
