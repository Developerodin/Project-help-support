'use client';

import * as React from 'react';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from './avatar.jsx';
import { initials } from '../icons.jsx';

function Message({
  className,
  align = 'start',
  showHeader = true,
  name,
  time,
  timeIso,
  avatar,
  meta,
  children,
  ...props
}) {
  return (
    <article
      data-slot="message"
      data-align={align}
      className={cn('message', className)}
      {...props}
    >
      {showHeader && (
        <header className="message-header">
          {avatar ?? (
            <Avatar size="sm" title={name}>
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
          )}
          <div className="message-meta">
            <b className="message-name">{name}</b>
            {time && (
              <time className="message-time" dateTime={timeIso || undefined}>
                {time}
              </time>
            )}
            {meta}
          </div>
        </header>
      )}
      {children}
    </article>
  );
}

export { Message };
