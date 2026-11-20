import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui';

const UnsavedChangesDialog = ({
  open,
  groupName,
  saving,
  onCancel,
  onDiscard,
  onSaveAndSwitch
}) => {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const savingRef = useRef(saving);

  useEffect(() => {
    onCancelRef.current = onCancel;
    savingRef.current = saving;
  }, [onCancel, saving]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" onClick={() => !saving && onCancel()} />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-group-title"
        aria-describedby="unsaved-group-description"
        className="relative w-full max-w-md rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-floating)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
            <AlertTriangle size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="unsaved-group-title" className="text-base font-semibold text-[var(--fg)]">
              尚未保存修改
            </h2>
            <p id="unsaved-group-description" className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              {groupName ? `“${groupName}”` : '当前群组'}有未保存的配置。切换群组前要先保存吗？
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={saving}>
            继续编辑
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={saving}>
            放弃修改
          </Button>
          <Button variant="primary" onClick={onSaveAndSwitch} disabled={saving}>
            {saving ? '保存中...' : '保存并切换'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UnsavedChangesDialog;
