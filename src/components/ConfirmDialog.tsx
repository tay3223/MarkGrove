import { useState, useCallback } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let resolveFn: ((value: boolean) => void) | null = null;
let showDialogFn: ((options: ConfirmOptions) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    resolveFn = resolve;
    showDialogFn?.(options);
  });
}

export default function ConfirmDialogContainer() {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: '', message: '' });

  const show = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setVisible(true);
  }, []);

  useState(() => {
    showDialogFn = show;
    return () => { showDialogFn = null; };
  });

  const handleConfirm = () => {
    setVisible(false);
    resolveFn?.(true);
    resolveFn = null;
  };

  const handleCancel = () => {
    setVisible(false);
    resolveFn?.(false);
    resolveFn = null;
  };

  if (!visible) return null;

  return (
    <div className="dialog-overlay" onClick={handleCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-title">{options.title}</div>
        <div className="dialog-message">{options.message}</div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-cancel" onClick={handleCancel}>
            {options.cancelLabel || '取消'}
          </button>
          <button
            className={`dialog-btn ${options.danger ? 'dialog-btn-danger' : 'dialog-btn-confirm'}`}
            onClick={handleConfirm}
          >
            {options.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
