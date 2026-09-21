import type { ImageRenderableSource } from "@opentui/core";
import type { ImageProps as OpenTUIImageProps } from "@opentui/react";

export interface ImageProps extends Omit<OpenTUIImageProps, "source"> {
  src: ImageRenderableSource;
}

export function Image({ src, ...props }: ImageProps) {
  return <image source={src} {...props} />;
}
