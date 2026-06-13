import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "ghost" | "subtle";
type Size = "sm" | "md";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name - icon-only controls have no visible text. */
  label: string;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  subtle: "bg-surface-2 text-text hover:bg-surface-3",
};

const SIZES: Record<Size, string> = {
  sm: "size-7",
  md: "size-9",
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control",
        "transition-[background-color,color,transform] duration-150 active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
