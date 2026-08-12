import { useEffect, useState, useCallback } from 'react';
import type { ToastMessage } from '../types';

let toastId = 0;
let addToastFn: ((toast: Omit<ToastMessage, 'id'>) => void) | null = null;

export function showToast(toast: Omit<ToastMessage, 'id'>) {
  addToastFn?.(toast);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${++toastId}`;
    const duration = toast.duration ?? (toast.type === 'error' ? 8000 : 4000);
    setToasts(prev => [...prev, { ...toast, id }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <div className="toast-message">{toast.message}</div>
            {toast.detail && (
              <div className="toast-detail">{toast.detail}</div>
            )}
            {toast.actions && toast.actions.length > 0 && (
              <div className="toast-actions">
                {toast.actions.map((action, i) => (
                  <button
                    key={i}
                    className="toast-action-btn"
                    onClick={() => {
                      action.onClick();
                      removeToast(toast.id);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="toast-close" onClick={() => removeToast(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
