'use client';
/**
 * Upload Evidence button + dialog for the subject-tenant detail page
 * and the claim Evidence tab.
 *
 * ## What it does
 *
 * Opens a Dialog that lets a consultant attach **up to 20 files at once**
 * (PDF, PNG, JPG, JPEG, TXT, MD, DOCX, DOC) as evidence against a
 * claimant chain. On submit it:
 *
 *   1. Validates each file client-side (type whitelist + 10 MB cap each).
 *   2. Computes the SHA-256 hex digest of each file's bytes using the
 *      Web Crypto API (SubtleCrypto.digest).
 *   3. Calls `uploadEvidence()` per file (concurrency-limited to 3
 *      simultaneous uploads to avoid saturating bandwidth or hitting
 *      API rate limits) — each file becomes its own EVIDENCE_UPLOADED
 *      event on the immutable chain so individual files can be
 *      disputed/inspected independently in audit defence.
 *   4. Tracks per-file status: queued → hashing → uploading → done | error.
 *   5. Toasts a batch summary on completion.
 *   6. Invalidates the queries for events/chain-status/subject-tenant
 *      so the feed and header badge refresh once the batch settles.
 *
 * ## Why a worker pool instead of `Promise.all(...)`
 *
 * 20 files × 10 MB ≈ 200 MB potential upload. Firing all 20 in parallel
 * saturates the user's connection and risks tripping API rate limits.
 * A concurrency-of-3 worker pool keeps wall-clock time short while
 * staying polite to the network and the server.
 *
 * ## Error handling per file
 *
 *   - ConflictError → marked "Already uploaded" — duplicate SHA-256
 *     for this claimant's chain (chain-of-custody dedup).
 *   - ForbiddenError → "Permission denied" — usually means the user
 *     became a viewer mid-batch; rare but caught.
 *   - Anything else → captured per-file error message, batch continues.
 *
 * If all 20 fail, the batch toast goes destructive. If some succeed
 * and some fail, the toast lists the count.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ConflictError, ForbiddenError } from '@/lib/api';
import { extractTextFromFile } from '@/lib/document-extract';
import { uploadEvidence } from '../_lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BYTES_PER_FILE = 50 * 1024 * 1024; // 50 MB — covers scanned PDFs, HEIC photos, modest video
const MAX_FILES = 20;
const UPLOAD_CONCURRENCY = 3;

/**
 * Denylist policy: accept anything that isn't a known executable or
 * script. The chain-of-custody recorder treats every file as opaque
 * bytes (hash + record metadata), so a strict whitelist would only
 * starve consultants of legitimate evidence formats they receive in
 * the wild — HEIC photos from iPhones, XLSX expenditure trackers,
 * P7M signed contracts, ODT files from open-source-using clients,
 * EML email exports, ZIP bundles, etc.
 *
 * Blocked extensions are the common Windows / Unix executable +
 * scripting surface. The hash + record path can't execute them, but
 * blocking at upload prevents accidental confusion with "valid
 * evidence files" downstream.
 */
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.dll',
  '.msi',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.js', // browser-executable in old IE; rare evidence; reject by default
  '.jse',
  '.wsf',
  '.wsh',
  '.sh',
  '.bash',
  '.zsh',
  '.app', // macOS bundle
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.dmg',
  '.iso',
]);

/**
 * `accept` attribute on the native picker. Empty string = accept any
 * file. We still validate via `isAccepted()` after the user picks, so
 * blocked types reach the consultant as a clear toast rather than
 * being silently invisible in the picker.
 */
const ACCEPTED_EXTENSIONS_ATTR = '';
const ACCEPTED_LABEL =
  'most documents, images, spreadsheets, presentations, audio, video, archives';

function fileExtensionLower(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function isAccepted(file: File): boolean {
  const ext = fileExtensionLower(file.name);
  // Block executables / scripts. Everything else is fair game — the
  // chain doesn't care about the bytes' shape, it just hashes them.
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Per-file state
// ---------------------------------------------------------------------------

type FileStatus = 'queued' | 'extracting' | 'hashing' | 'uploading' | 'done' | 'error';

interface FileEntry {
  id: string; // local-only stable key for React rendering
  file: File;
  status: FileStatus;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Concurrency-limited worker pool
// ---------------------------------------------------------------------------

/**
 * Runs an async worker over a list of items with bounded parallelism.
 * Returns when every item has settled. Item-level errors are passed to
 * the worker via try/catch — this helper does NOT throw or short-circuit,
 * mirroring `Promise.allSettled` semantics.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  subjectTenantId: string;
  triggerLabel?: string;
  triggerVariant?: 'default' | 'outline' | 'ghost' | 'secondary';
}

export function UploadEvidenceButton({
  subjectTenantId,
  triggerLabel = 'Upload evidence',
  triggerVariant = 'outline',
}: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [description, setDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const isUploading = entries.some((e) => e.status === 'hashing' || e.status === 'uploading');

  const updateEntry = (id: string, patch: Partial<FileEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const onPickFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    const incomingArr = Array.from(incoming);
    const slotsLeft = MAX_FILES - entries.length;
    if (slotsLeft <= 0) {
      toast({
        title: `Maximum ${MAX_FILES} files`,
        description: 'Remove a file before adding more.',
        variant: 'destructive',
      });
      return;
    }
    const accepted: FileEntry[] = [];
    const rejected: string[] = [];
    for (const f of incomingArr.slice(0, slotsLeft)) {
      if (!isAccepted(f)) {
        rejected.push(`${f.name}: executable / script blocked`);
        continue;
      }
      if (f.size === 0) {
        rejected.push(`${f.name}: file is empty`);
        continue;
      }
      if (f.size > MAX_BYTES_PER_FILE) {
        rejected.push(`${f.name}: over 50 MB`);
        continue;
      }
      accepted.push({
        id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2)}`,
        file: f,
        status: 'queued',
      });
    }
    if (rejected.length > 0) {
      toast({
        title: `Skipped ${rejected.length} ${rejected.length === 1 ? 'file' : 'files'}`,
        description: rejected.slice(0, 3).join(' · ') + (rejected.length > 3 ? ' · …' : ''),
        variant: 'destructive',
      });
    }
    if (accepted.length > 0) {
      setEntries((prev) => [...prev, ...accepted]);
    }
    // Reset native input so the same file can be re-picked after removal.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      let okCount = 0;
      let failCount = 0;
      let dupCount = 0;
      const trimmedDescription = description.trim();

      await runWithConcurrency(entries, UPLOAD_CONCURRENCY, async (entry) => {
        try {
          // Step 1: extract text from the document (non-fatal if unsupported).
          updateEntry(entry.id, { status: 'extracting' });
          const extractedText = await extractTextFromFile(entry.file);

          // Step 2: compute SHA-256 hash.
          updateEntry(entry.id, { status: 'hashing' });
          const hash = await sha256Hex(entry.file);

          // Step 3: upload with extracted text embedded in the raw_text payload.
          updateEntry(entry.id, { status: 'uploading' });
          await uploadEvidence({
            subject_tenant_id: subjectTenantId,
            file: entry.file,
            sha256: hash,
            description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
            extracted_text: extractedText ?? undefined,
          });
          updateEntry(entry.id, { status: 'done' });
          okCount++;
        } catch (err) {
          if (err instanceof ConflictError) {
            updateEntry(entry.id, {
              status: 'error',
              errorMessage: 'Already on chain (duplicate hash)',
            });
            dupCount++;
            return; // count separately, not a hard fail
          }
          if (err instanceof ForbiddenError) {
            updateEntry(entry.id, { status: 'error', errorMessage: 'Permission denied' });
          } else {
            updateEntry(entry.id, {
              status: 'error',
              errorMessage: err instanceof Error ? err.message : 'Upload failed',
            });
          }
          failCount++;
        }
      });

      return { okCount, failCount, dupCount };
    },
    onSuccess: (result) => {
      // Refresh the audit + chain feeds once everything has settled.
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['chain-status', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['subject-tenant', subjectTenantId] });

      const { okCount, failCount, dupCount } = result;
      if (failCount === 0 && dupCount === 0) {
        toast({
          title: `Uploaded ${okCount} ${okCount === 1 ? 'file' : 'files'}`,
        });
        // Auto-close on clean success.
        setOpen(false);
        resetState();
      } else if (okCount === 0) {
        toast({
          title: 'No files uploaded',
          description:
            failCount > 0
              ? `${failCount} ${failCount === 1 ? 'file' : 'files'} failed.`
              : `${dupCount} already on chain.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Uploaded ${okCount} of ${entries.length}`,
          description: [
            failCount > 0 ? `${failCount} failed` : null,
            dupCount > 0 ? `${dupCount} duplicates` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        });
      }
    },
    onError: (err) => {
      toast({
        title: 'Batch upload failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const resetState = () => {
    setEntries([]);
    setDescription('');
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isUploading) {
      resetState();
    }
    if (next || !isUploading) {
      setOpen(next);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className="gap-2">
          <Upload className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload evidence files</DialogTitle>
          <DialogDescription>
            Attach up to {MAX_FILES} files at once. Each file&apos;s SHA-256 hash is recorded on the
            immutable claimant chain. Accepts {ACCEPTED_LABEL} — Word, Excel, PowerPoint, PDF,
            images, CSV, ZIP, EML, and more. Maximum 50&nbsp;MB per file. Executables and scripts
            are blocked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File picker — drag-drop area + button */}
          <DropArea
            onPickFiles={onPickFiles}
            disabled={isUploading}
            inputRef={fileInputRef}
            entriesCount={entries.length}
          />

          {/* Selected files list */}
          {entries.length > 0 && (
            <div className="rounded border border-border divide-y divide-border max-h-72 overflow-y-auto">
              {entries.map((entry) => (
                <FileRow
                  key={entry.id}
                  entry={entry}
                  onRemove={() => removeEntry(entry.id)}
                  uploading={isUploading}
                />
              ))}
            </div>
          )}

          {/* Shared description applied to all files */}
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Description{' '}
              <span className="font-normal text-muted-foreground/60 normal-case">
                (optional, applied to every file)
              </span>
            </label>
            <Textarea
              placeholder="Brief context — e.g. Q1 2026 lab notebook scans, ASIC company searches…"
              className="min-h-[64px] resize-y"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={isUploading || entries.length === 0}
          >
            {isUploading
              ? `Uploading ${entries.filter((e) => e.status === 'done').length}/${entries.length}…`
              : `Upload ${entries.length || ''} ${entries.length === 1 ? 'file' : 'files'}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function DropArea({
  onPickFiles,
  disabled,
  inputRef,
  entriesCount,
}: {
  onPickFiles: (files: FileList | null) => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  entriesCount: number;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDragOver(false);
        onPickFiles(e.dataTransfer.files);
      }}
      className={[
        'flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-6 py-7 text-center transition-colors',
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-border bg-secondary/30 hover:bg-secondary/50',
        disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS_ATTR}
        multiple
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      <Upload className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">
        {isDragOver ? 'Drop to add to batch' : 'Drag & drop files, or click to choose'}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Up to {MAX_FILES} files · {entriesCount} of {MAX_FILES} selected
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="mt-1"
      >
        Choose files
      </Button>
    </div>
  );
}

function FileRow({
  entry,
  onRemove,
  uploading,
}: {
  entry: FileEntry;
  onRemove: () => void;
  uploading: boolean;
}) {
  const sizeLabel = formatBytes(entry.file.size);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{entry.file.name}</p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {sizeLabel}
          {entry.errorMessage ? ` · ${entry.errorMessage}` : ''}
        </p>
      </div>
      <StatusBadge status={entry.status} />
      {!uploading && entry.status === 'queued' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${entry.file.name}`}
          className="h-7 w-7 p-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  const base = 'inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest';
  switch (status) {
    case 'queued':
      return <span className={`${base} text-muted-foreground`}>Queued</span>;
    case 'extracting':
      return (
        <span className={`${base} text-primary`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Extracting
        </span>
      );
    case 'hashing':
      return (
        <span className={`${base} text-primary`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Hashing
        </span>
      );
    case 'uploading':
      return (
        <span className={`${base} text-primary`}>
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading
        </span>
      );
    case 'done':
      return (
        <span className={`${base} text-primary`}>
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case 'error':
      return (
        <span className={`${base} text-destructive`}>
          <AlertCircle className="h-3 w-3" />
          Error
        </span>
      );
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
