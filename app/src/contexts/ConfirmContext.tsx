import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '../components/ui';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (o: ConfirmOptions | string) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

/** In-app confirm dialog (native window.confirm is blocked in embedded/hosted frames and is poor on mobile). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(typeof o === 'string' ? { message: o } : o);
    return new Promise<boolean>((res) => { resolver.current = res; });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? 'Are you sure?'}
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{opts?.confirmLabel ?? 'Confirm'}</Button>
        </>}>
        <p className="text-steel-700">{opts?.message}</p>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfirm outside ConfirmProvider');
  return v;
}
