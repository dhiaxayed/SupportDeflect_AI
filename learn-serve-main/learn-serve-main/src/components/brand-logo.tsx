import logoUrl from "@/assets/official-logo.png";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  showText?: boolean;
  textClassName?: string;
};

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
