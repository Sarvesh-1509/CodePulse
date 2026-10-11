import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-cyan-400 text-slate-950 hover:bg-cyan-300",
        outline:
          "border border-border bg-transparent text-slate-100 hover:bg-white/5",
        secondary: "bg-surface text-slate-100 hover:bg-white/10",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));
    if (asChild && React.isValidElement(props.children)) {
      const child = props.children as React.ReactElement<{
        className?: string;
        ref?: React.Ref<HTMLElement>;
      }>;
      return React.cloneElement(child, {
        ref,
        className: cn(classes, child.props.className),
      });
    }
    return <button className={classes} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
