"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
}

// No `loading="lazy"` here, deliberately: it would not do anything. Radix
// decides between the image and the fallback by preloading through a detached
// `new window.Image()` in an effect (react-avatar/dist/index.mjs:84), so the
// fetch fires for every mounted avatar whatever the rendered <img> asks for.
// A screen of 30 avatars requests 30 images either way.
//
// That is survivable now the objects are ~25 KB and the service worker caches
// them (next.config.mjs), and off-screen deferral is not worth swapping Radix
// out for. The plain-<img> avatars elsewhere — FeedCard, CommentSection,
// ReactorsSheet, MentionInput — do lazy-load properly.
function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      decoding="async"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
