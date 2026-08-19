'use client';

import * as React from 'react';

import { cn } from '@/shared/lib/utils';

const AvatarContext = React.createContext({
  imageLoaded: false,
  setImageLoaded: () => {},
  imageFailed: false,
  setImageFailed: () => {},
});

function Avatar({
  className,
  size = 'default',
  children,
  ...props
}) {
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);
  const ctx = React.useMemo(
    () => ({ imageLoaded, setImageLoaded, imageFailed, setImageFailed }),
    [imageLoaded, imageFailed],
  );

  return (
    <AvatarContext.Provider value={ctx}>
      <span
        data-slot="avatar"
        data-size={size}
        className={cn(className)}
        {...props}
      >
        {children}
      </span>
    </AvatarContext.Provider>
  );
}

function AvatarImage({
  className,
  src,
  alt = '',
  ...props
}) {
  const { setImageLoaded, setImageFailed } = React.useContext(AvatarContext);

  if (!src) return null;

  return (
    <img
      data-slot="avatar-image"
      src={src}
      alt={alt}
      className={cn(className)}
      onLoad={() => setImageLoaded(true)}
      onError={() => setImageFailed(true)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  children,
  ...props
}) {
  const { imageLoaded, imageFailed } = React.useContext(AvatarContext);

  if (imageLoaded && !imageFailed) return null;

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(className)}
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      {children}
    </span>
  );
}

function AvatarGroup({
  className,
  'aria-label': ariaLabel = 'Watchers',
  ...props
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="avatar-group"
      className={cn(className)}
      {...props}
    />
  );
}

function AvatarGroupCount({
  className,
  size = 'sm',
  children,
  ...props
}) {
  return (
    <span
      data-slot="avatar-group-count"
      data-size={size}
      className={cn(className)}
      {...props}
    >
      {children}
    </span>
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
};
