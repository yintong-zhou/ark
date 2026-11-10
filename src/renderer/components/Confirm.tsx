import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useOverlay } from '../browser/overlay';
import { BUTTON, CTA } from './ui';

type Request = { message: string; resolve: (answer: boolean) => void };
let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Queues confirmations, including requests originating outside React components. */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { message, resolve }];
    emit();
  });
}

export function ConfirmHost() {
  const current = useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), () => queue[0]);
  useEffect(() => window.ark.window.onConfirmUnload(() => {
    void confirmAction('Some files have unsaved changes. Discard them and leave?').then(window.ark.window.confirmUnloadResult);
  }), []);
  return current ? <ConfirmDialog key={current.message} request={current} /> : null;
}

function ConfirmDialog({ request }: { request: Request }) {
  useOverlay();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const answer = (value: boolean) => {
    if (queue[0] !== request) return;
    queue = queue.slice(1);
    request.resolve(value);
    emit();
  };
  return (
    <dialog ref={ref} aria-labelledby="confirm-title" aria-describedby="confirm-message" onCancel={(e) => { e.preventDefault(); answer(false); }} className="surface-floating m-auto w-[min(440px,calc(100vw-32px))] rounded-lg bg-sidebar p-0 text-secondary backdrop:bg-primary/80">
      <div className="flex flex-col gap-2 p-3">
        <h2 id="confirm-title" className="text-title">Confirm action</h2>
        <p id="confirm-message" className="break-words text-body text-neutral-light">{request.message}</p>
        <div className="flex justify-end gap-1 pt-1">
          <button autoFocus onClick={() => answer(false)} className={BUTTON}>Cancel</button>
          <button onClick={() => answer(true)} className={CTA}>Confirm</button>
        </div>
      </div>
    </dialog>
  );
}
