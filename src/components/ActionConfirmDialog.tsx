import React from 'react';
import { ShieldAlert, Phone, MessageSquare, Mail, Trash2, Check, X } from 'lucide-react';
import {
  usePendingActionConfirmation,
  resolvePendingActionConfirmation,
} from '../lib/actionConfirmationStore';

export function ActionConfirmDialog() {
  const pending = usePendingActionConfirmation();
  if (!pending) return null;

  const getIcon = () => {
    switch (pending.toolName) {
      case 'make_call':
        return <Phone className="w-5 h-5 text-emerald-400" />;
      case 'send_text':
        return <MessageSquare className="w-5 h-5 text-indigo-400" />;
      case 'email_send':
        return <Mail className="w-5 h-5 text-purple-400" />;
      case 'email_delete':
        return <Trash2 className="w-5 h-5 text-rose-400" />;
      default:
        return <ShieldAlert className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div
      data-testid="app-action-confirm-dialog"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl overflow-hidden text-zinc-100">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="p-2 rounded-xl bg-zinc-800/80 border border-zinc-700/60 shrink-0">
            {getIcon()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              User Confirmation Required
            </div>
            <h3
              id="app-confirm-dialog-title"
              className="text-sm font-bold text-zinc-100 truncate"
            >
              {pending.title}
            </h3>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-zinc-300 leading-relaxed">{pending.summary}</p>

          {pending.fields.length > 0 && (
            <div className="rounded-xl bg-zinc-950/90 border border-zinc-800 p-3 space-y-2 max-h-56 overflow-y-auto">
              {pending.fields.map((field, idx) => (
                <div key={idx} className="text-xs">
                  <span className="text-zinc-500 font-semibold uppercase text-[10px] tracking-wider block">
                    {field.label}
                  </span>
                  <span className="text-zinc-200 break-words whitespace-pre-wrap font-mono text-[11px]">
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-zinc-400">
            Sierra cannot confirm this action automatically. Tap{' '}
            <strong className="text-zinc-200">{pending.confirmLabel || 'Confirm'}</strong> to proceed
            or <strong className="text-zinc-200">{pending.cancelLabel || 'Cancel'}</strong> to abort.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-zinc-800 bg-zinc-950/60">
          <button
            type="button"
            data-testid="app-action-confirm-cancel-btn"
            onClick={() => resolvePendingActionConfirmation(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors min-h-[40px]"
          >
            <X className="w-3.5 h-3.5" />
            <span>{pending.cancelLabel || 'Cancel'}</span>
          </button>
          <button
            type="button"
            data-testid="app-action-confirm-approve-btn"
            onClick={() => resolvePendingActionConfirmation(true)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors min-h-[40px] ${
              pending.isDestructive
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{pending.confirmLabel || 'Confirm'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
