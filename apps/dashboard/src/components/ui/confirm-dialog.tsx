"use client";

/**
 * Radix Dialog wrapped in M3 styling — replaces window.confirm/alert
 * across the dashboard (P0-3 in FF_DASHBOARD_FRONTEND_AUDIT.md). Native
 * popups break out of the theme into Internet-Explorer chrome, which
 * was the most concrete "amateur demo" tell after the initial smoke
 * test.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Revoke API key?"
 *     description="The key stops working immediately. This cannot be undone."
 *     confirmLabel="Revoke"
 *     destructive
 *     onConfirm={() => revoke(key.id)}
 *   />
 */
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  async function handleConfirm() {
    await onConfirm();
    onOpenChange(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-scrim/60 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <Dialog.Content
          className={cn(
            "fixed z-40 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[min(28rem,calc(100vw-2rem))] md-surface rounded-m3-lg",
            "border ff-hairline shadow-m3-3",
            "px-6 py-5 md-fade-in",
            "focus:outline-none"
          )}
        >
          <Dialog.Title className="md-typescale-headline-small text-on-surface">
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-2 md-typescale-body-medium text-on-surface-variant">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-6 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={busy}
                className="px-4 h-10 rounded-m3-full md-typescale-label-large border border-outline text-primary bg-transparent hover:bg-primary/[0.04] transition-colors disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className={cn(
                "px-4 h-10 rounded-m3-full md-typescale-label-large transition-shadow",
                destructive
                  ? "bg-error text-error-on shadow-m3-1 hover:shadow-m3-2"
                  : "bg-primary text-primary-on shadow-m3-1 hover:shadow-m3-2",
                "disabled:opacity-60"
              )}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
