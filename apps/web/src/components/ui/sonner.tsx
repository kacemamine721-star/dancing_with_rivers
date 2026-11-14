import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** App toaster (prototype `.toast`), themed with the design tokens. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: 'glass !bg-[rgba(7,17,27,.94)] !border-teal-dim !text-ink font-sans text-sm shadow-xl',
          description: '!text-mute',
          actionButton: '!bg-teal !text-on-teal font-mono uppercase tracking-btn',
          cancelButton: '!bg-ink/10 !text-ink',
        },
      }}
      {...props}
    />
  );
}
