import { useState, useCallback, useEffect } from 'react';

export interface DialogButton {
  label: string;
  value: string;
  danger?: boolean;
  primary?: boolean;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Multi-button mode: if provided, overrides confirm/cancel labels */
  buttons?: DialogButton[];
}

let resolveFn: ((value: any) => void) | null = null;
let showDialogFn: ((options: ConfirmOptions) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    resolveFn = (v) => resolve(!!v);
    showDialogFn?.(options);
  });
}

/** Show a dialog with custom buttons. Returns the button's value. */
export function choiceDialog(options: ConfirmOptions & { buttons: DialogButton[] }): Promise<string> {
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

  useEffect(() => {
    showDialogFn = show;
    return () => { showDialogFn = null; };
  }, [show]);

  const handleResult = (value: any) => {
    setVisible(false);
    resolveFn?.(value);
    resolveFn = null;
  };

  if (!visible) return null;

  // Multi-button mode
  if (options.buttons && options.buttons.length > 0) {
    return (
      <div className="dialog-overlay" onClick={() => handleResult('cancel')}>
        <div className="dialog" onClick={e => e.stopPropagation()}>
          <div className="dialog-title">{options.title}</div>
          <div className="dialog-message">{options.message}</div>
          <div className="dialog-actions">
            {options.buttons.map(btn => (
              <button
                key={btn.value}
                className={`dialog-btn ${btn.danger ? 'dialog-btn-danger' : btn.primary ? 'dialog-btn-confirm' : 'dialog-btn-cancel'}`}
                onClick={() => handleResult(btn.value)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Legacy confirm/cancel mode
  return (
    <div className="dialog-overlay" onClick={() => handleResult(false)}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-title">{options.title}</div>
        <div className="dialog-message">{options.message}</div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-cancel" onClick={() => handleResult(false)}>
            {options.cancelLabel || '取消'}
          </button>
          <button
            className={`dialog-btn ${options.danger ? 'dialog-btn-danger' : 'dialog-btn-confirm'}`}
            onClick={() => handleResult(true)}
          >
            {options.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
