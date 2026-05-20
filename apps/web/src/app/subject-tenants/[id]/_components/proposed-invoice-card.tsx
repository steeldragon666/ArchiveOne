'use client';
/**
 * ProposedInvoiceCard
 *
 * Surfaces one AI-extracted invoice record from an uploaded document.
 * Shows vendor, date, amount, line items, confidence, and source excerpt.
 *
 * The "Add to expenditure" button immediately creates an expenditure record
 * via POST /v1/proposed-invoices/:event_id/accept and transitions to a
 * "Added · EXP-ID" success state.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Receipt,
  Link2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { acceptProposedInvoice } from '../_lib/extraction-api';
import type { ProposedInvoiceExtract } from '../_lib/extraction-api';

interface Props {
  eventId: string;
  invoiceIndex: number;
  invoice: ProposedInvoiceExtract;
  subjectTenantId: string;
  /**
   * Filename of the upload-event this invoice was extracted from. Surfaced
   * in the card and success state so the consultant can see that confirming
   * the invoice also links it to the source document on the chain
   * (ARTEFACT_LINKED event emitted server-side).
   */
  sourceFilename: string;
}

export function ProposedInvoiceCard({
  eventId,
  invoiceIndex,
  invoice,
  subjectTenantId,
  sourceFilename,
}: Props) {
  const [lineItemsExpanded, setLineItemsExpanded] = useState(false);
  const [excerptExpanded, setExcerptExpanded] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => acceptProposedInvoice(eventId, invoiceIndex),
    onSuccess: (result) => {
      setCreatedId(result.expenditure_id);
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['expenditures'] });
      toast({
        title: `Invoice added — $${result.total_aud.toLocaleString('en-AU', { minimumFractionDigits: 2 })} from ${result.vendor_name}`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to add invoice',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const confidencePct = Math.round(invoice.confidence * 100);
  const confidenceColour =
    invoice.confidence >= 0.8
      ? 'text-[hsl(var(--brand-accent-strong))]'
      : invoice.confidence >= 0.6
        ? 'text-[hsl(var(--brand-warning))]'
        : 'text-muted-foreground';

  const formatAud = (n: number) =>
    n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

  if (createdId) {
    return (
      <div className="rounded border border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-subtle))]/20 px-4 py-3 flex items-start gap-3">
        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--brand-accent-strong))] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Confirmed · added to expenditure</p>
          <p className="font-mono text-[10px] text-muted-foreground truncate">
            {invoice.vendor_name} · {formatAud(invoice.total_aud)}
          </p>
          <p className="font-mono text-[10px] text-[hsl(var(--brand-accent-strong))] mt-1 flex items-center gap-1">
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate" title={sourceFilename}>
              Linked to {sourceFilename}
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        {/* Header: vendor + amounts + confidence */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="rounded bg-muted p-1.5 shrink-0">
              <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm leading-tight truncate">{invoice.vendor_name}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {invoice.invoice_date}
                {invoice.invoice_number && ` · Inv #${invoice.invoice_number}`}
              </p>
              <p
                className="font-mono text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1"
                title={`Will be linked to ${sourceFilename}`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">From {sourceFilename}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <p className="font-display font-medium text-sm tabular-nums">
              {formatAud(invoice.total_aud)}
            </p>
            {invoice.gst_aud !== null && (
              <p className="font-mono text-[10px] text-muted-foreground">
                GST {formatAud(invoice.gst_aud)}
              </p>
            )}
            <span className={`font-mono text-[10px] ${confidenceColour}`}>
              {confidencePct}% confidence
            </span>
          </div>
        </div>

        {/* Line items (collapsible) */}
        {invoice.line_items.length > 0 && (
          <div className="rounded border border-border/40 bg-muted/20 px-3 py-2">
            <button
              type="button"
              onClick={() => setLineItemsExpanded((v) => !v)}
              className="w-full flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              {invoice.line_items.length} line {invoice.line_items.length === 1 ? 'item' : 'items'}
              {lineItemsExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {lineItemsExpanded && (
              <div className="mt-2 space-y-1">
                {invoice.line_items.map((li, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-xs">
                    <p className="text-foreground/80 leading-snug flex-1">{li.description}</p>
                    <p className="font-mono tabular-nums shrink-0 text-muted-foreground">
                      {formatAud(li.amount_aud)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Source excerpt (collapsible) */}
        <div className="rounded border border-border/40 bg-muted/30 px-3 py-2">
          <button
            type="button"
            onClick={() => setExcerptExpanded((v) => !v)}
            className="w-full flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Source excerpt
            {excerptExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {excerptExpanded && (
            <p className="mt-2 text-[11px] font-mono leading-relaxed text-foreground/70 whitespace-pre-wrap">
              &ldquo;{invoice.source_excerpt}&rdquo;
            </p>
          )}
        </div>

        {/* Action */}
        <div className="pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="h-8 text-xs gap-1.5"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Confirming…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirm & link invoice
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
