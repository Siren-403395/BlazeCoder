import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active shadow-soft",
  ghost: "border border-border text-text hover:border-border-strong hover:bg-surface-2",
  subtle: "border border-transparent bg-surface-2 text-text hover:bg-surface-3",
  danger: "border border-danger-subtle text-danger-text hover:bg-danger-subtle",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export function Button({ variant = "subtle", size = "md", className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-medium",
        "transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px",
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
