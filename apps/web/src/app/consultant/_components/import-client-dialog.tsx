'use client';

/**
 * Stub modal for the consultant dashboard "+ Import client" button.
 *
 * The full import flow is task D5a (out of scope for D5 — that lands a
 * proper Xero / CSV / manual entry wizard). For now this modal says
 * "Import client — coming soon" so the click does something visible
 * and we don't ship a dead button.
 *
 * Self-contained: no router, no fetch, no portal — just a fixed-position
 * overlay + a small card. Styled with the consultant workspace's tokens
 * to match the surrounding aesthetic.
 */

import { useEffect } from 'react';
import {
  amber,
  bone,
  bone3,
  fMono,
  fSans,
  fSerif,
  ink,
  ink2,
  rule,
  ruleStrong,
} from './tokens';
import { Diamond, MonoLabel } from './atoms';

export interface ImportClientDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ImportClientDialog({ open, onClose }: ImportClientDialogProps) {
  // Close on Esc — minimal keyboard support so the stub doesn't trap
  // focus indefinitely. A proper focus-trap lands with the real D5a modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-client-dialog-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,11,13,0.72)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: 'calc(100vw - 48px)',
          background: ink2,
          border: `1px solid ${ruleStrong}`,
          borderRadius: 4,
          color: bone,
          fontFamily: fSans,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 22px',
            borderBottom: `1px solid ${rule}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Diamond size={8} />
          <MonoLabel size={10} color={bone3} tracking="0.22em">
            Import client
          </MonoLabel>
        </div>
        <div style={{ padding: '24px 22px 22px' }}>
          <h2
            id="import-client-dialog-title"
            style={{
              fontFamily: fSerif,
              fontWeight: 300,
              fontSize: 28,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              color: bone,
              margin: 0,
            }}
          >
            Import client — coming soon.
          </h2>
          <p
            style={{
              fontFamily: fSans,
              fontSize: 14,
              color: bone3,
              margin: '12px 0 0',
              lineHeight: 1.5,
            }}
          >
            We&rsquo;re wiring up Xero + manual entry next. For now, create a new
            claim directly and the wizard will let you set up the client inline.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                background: amber,
                color: ink,
                border: 'none',
                borderRadius: 3,
                fontFamily: fMono,
                fontSize: 11,
                letterSpacing: '0.18em',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              GOT IT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
