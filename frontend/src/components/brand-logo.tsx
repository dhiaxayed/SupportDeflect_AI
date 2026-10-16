/**
 * @file Local first-party brand rendering used by marketing, authentication and workspace
 * shells. Import the bundled image instead of a remote tracker; callers choose layout classes
 * and optional adjacent text while the image retains its accessible product name.
 */

import logoUrl from "@/assets/official-logo.png";
import { cn } from "@/lib/utils";

/**
 * Presentation overrides for one logo instance; showText defaults off because the image
 * already includes the product identity.
 */
type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  showText?: boolean;
  textClassName?: string;
};

/**
 * Render the bundled logo with optional product text and independently overridable
 * container/image/text classes; preserve the artwork's aspect ratio.
 */
export function BrandLogo({
  className,
  imageClassName,
  showText = false,
  textClassName,
}: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <img
        src={logoUrl}
        alt="SupportDeflect AI"
        className={cn("h-8 w-auto shrink-0 object-contain", imageClassName)}
      />
      {showText && (
        <span className={cn("font-semibold tracking-tight", textClassName)}>SupportDeflect AI</span>
      )}
    </div>
  );
}
