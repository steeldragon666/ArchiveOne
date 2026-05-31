import type { ReactNode } from 'react';
import { amber, bone3, fMono, fSans, ink3, rule, sage } from '../tokens';
import { Diamond, MonoLabel } from '../atoms';
import { ConflictError, NotFoundError } from '@/lib/api';
import type { FinanceResult, SealResult } from '../claims-api';
import { ErrorText } from './primitives';
import { formatTs, primaryBtn } from './utils';

/* ─────────────────────────── Finalize sub-UI ───────────────────────── */

export function FinalizeRow({
  ordinal,
  title,
  body,
  children,
}: {
  ordinal: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: '16px 18px',
        background: ink3,
        border: `1px solid ${rule}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <MonoLabel size={10} color={bone3}>
          {ordinal} · {title}
        </MonoLabel>
        <div style={{ marginTop: 5, fontFamily: fSans, fontSize: 13, color: bone3 }}>{body}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function FinalizeButton({
  label,
  pendingLabel,
  enabled,
  disabledHint,
  pending,
  error,
  conflictReason,
  onClick,
}: {
  label: string;
  pendingLabel: string;
  enabled: boolean;
  disabledHint: string;
  pending: boolean;
  error: Error | null;
  /** 409 reason to surface inline (e.g. not_approved / not_sealed). */
  conflictReason: string | null;
  onClick: () => void;
}) {
  // A 404 means the endpoint is being built in parallel and isn't live yet —
  // surface an honest "not available yet" affordance, never a crash.
  const notAvailableYet = error instanceof NotFoundError;
  const disabled = !enabled || pending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={enabled ? undefined : disabledHint}
        style={primaryBtn(disabled)}
      >
        {pending ? pendingLabel : label}
      </button>
      {notAvailableYet && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Diamond size={6} filled={false} color={bone3} />
          <MonoLabel size={9} color={bone3} tracking="0.12em">
            NOT AVAILABLE YET
          </MonoLabel>
        </span>
      )}
      {conflictReason && <ErrorText>{conflictReason}</ErrorText>}
      {error && !notAvailableYet && !conflictReason && (
        <ErrorText>Couldn&rsquo;t complete that. Try again.</ErrorText>
      )}
    </div>
  );
}

export function SealedState({ result }: { result: SealResult }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'rgba(225,162,58,0.12)',
        border: `1px solid ${amber}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Diamond size={7} color={amber} />
      <div>
        <MonoLabel size={9.5} color={amber}>
          SEALED · BLOCK {result.block_id.slice(0, 12)}
        </MonoLabel>
        <div style={{ marginTop: 3, fontFamily: fMono, fontSize: 9.5, color: bone3 }}>
          {formatTs(result.sealed_at)}
        </div>
      </div>
    </div>
  );
}

export function FinancingState({ result }: { result: FinanceResult }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'rgba(122,150,133,0.14)',
        border: `1px solid ${sage}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Diamond size={7} color={sage} />
      <div>
        <MonoLabel size={9.5} color={sage}>
          FINANCING REQUESTED · {result.financing.status.toUpperCase()}
        </MonoLabel>
        <div style={{ marginTop: 3, fontFamily: fMono, fontSize: 9.5, color: bone3 }}>
          {formatTs(result.financing.requested_at)}
        </div>
      </div>
    </div>
  );
}

/**
 * Surface a 409 conflict message inline. The expected code (not_approved /
 * not_sealed) is documented for clarity; we show the server's message for
 * any 409 so an unexpected conflict still reaches the consultant.
 */
export function conflictReasonFor(error: Error | null, _expectedCode: string): string | null {
  return error instanceof ConflictError ? error.message : null;
}
