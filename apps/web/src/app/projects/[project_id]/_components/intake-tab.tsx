'use client';
/**
 * Project information-intake tab.
 *
 * After a project is created, the consultant needs explicit, discoverable
 * paths to feed information INTO it. This tab is the "load data" hub —
 * three primary ingestion lanes, each addressing a different way evidence
 * arrives at a consultancy:
 *
 *   1. Email forward — clients send evidence via email; the project gets
 *      a deterministic dedicated address that, when written to, creates
 *      evidence events on the chain.
 *   2. Cloud sync — the consultant or client points a Drive / Dropbox /
 *      OneDrive shared folder at the project; new files there flow in
 *      automatically. Google Drive is fully wired; Dropbox / OneDrive
 *      are pending separate connector work.
 *   3. Direct upload — the consultant drags-and-drops files in the
 *      browser. Already shipped (UploadEvidenceButton); this tab exposes
 *      it as a project-level entry point.
 *
 * Cloud sync flow (Drive):
 *   a. Consultant clicks "Connect Google Drive" on the Drive tab.
 *   b. POST /initiate returns an authorization_url; the browser is
 *      redirected to Google's consent screen.
 *   c. Google redirects back to /v1/cloud-sync/google-drive/callback,
 *      which stores the tokens and redirects to
 *      /projects/:id?tab=intake&cs_pending=<connection_id>.
 *   d. The intake tab detects cs_pending in the URL, shows a folder-
 *      picker dialog (listDriveFolders), and on folder selection PATCHes
 *      the connection with the chosen folder.
 *   e. The status badge transitions from "Pending folder selection"
 *      to "Connected" once the PATCH succeeds.
 *
 * The deterministic email address is `project-{short-id}@inbox.<base>`
 * where short-id = first 8 hex chars of the project UUID. ~32 bits of
 * entropy is enough that an external sender can't fish for project
 * addresses, while still being human-readable when the consultant
 * shares it. The `<base>` domain is taken from the firm's brand_config
 * (custom_subdomain or default).
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Mail,
  Cloud,
  Upload,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { UploadEvidenceButton } from '../../../subject-tenants/[id]/_components/upload-evidence-button';
import type { Project, CloudSyncConnection } from '@cpa/schemas';
import {
  listCloudSyncConnections,
  initiateGoogleDriveConnection,
  listDriveFolders,
  setConnectionFolder,
  disconnectCloudSync,
  type FolderItem,
} from '../_lib/cloud-sync-api';

interface Props {
  project: Project;
}

/**
 * Default inbound-mail base domain. In production this is overridden per
 * firm via `brand_config.email_sender_domain` once DKIM is verified —
 * letting consultants brand their forwarding address as
 * `project-XXXX@in.<theirfirm>.com.au` instead of the platform's. Until
 * that wiring lands, the platform-default sub-domain is shown.
 */
const DEFAULT_INBOX_DOMAIN = 'inbox.claimsure.com.au';

function projectInboxAddress(projectId: string, domain: string = DEFAULT_INBOX_DOMAIN): string {
  // First 8 hex chars (skip dashes) — 32 bits of entropy, hard to guess
  // by enumeration, easy enough to dictate over a phone call.
  const short = projectId.replace(/-/g, '').slice(0, 8);
  return `project-${short}@${domain}`;
}

export function IntakeTab({ project }: Props) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Project · Information intake
        </p>
        <h2 className="font-display text-2xl font-medium">
          Three ways to load information into this project
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Each path produces a hash-chained evidence event on the project's audit trail — identical
          forensic guarantees regardless of how the file arrives.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <EmailInboxCard projectId={project.id} />
        <CloudSyncCard projectId={project.id} />
        <DirectUploadCard project={project} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Email inbox card
// ─────────────────────────────────────────────────────────────────────────

function EmailInboxCard({ projectId }: { projectId: string }) {
  const address = projectInboxAddress(projectId);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const onCopy = () => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      toast({ title: 'Copied to clipboard' });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="rounded bg-primary/10 p-2 text-primary">
            <Mail className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Path 1
            </p>
            <h3 className="font-display text-lg font-medium">Email forward</h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Forward client emails — meeting recaps, photo attachments, lab notes — to this dedicated
          address. The subject line becomes the event title; attachments are ingested as evidence
          with their SHA-256 hashes recorded on the chain.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs px-3 py-2.5 rounded bg-muted text-foreground break-all">
            {address}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={onCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="rounded bg-secondary/40 border border-border px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Status
          </p>
          <p className="text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--brand-warning))] mr-2 align-middle" />
            Pending connector setup — the address is reserved but the inbound mail handler is being
            provisioned. Sending now will bounce.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cloud sync card — now fully wired for Google Drive
// ───────────────────────────────────────────────────────────────────��─────

type CloudProviderId = 'dropbox' | 'gdrive' | 'onedrive';

interface CloudProvider {
  id: CloudProviderId;
  label: string;
}

const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: 'dropbox', label: 'Dropbox' },
  { id: 'gdrive', label: 'Google Drive' },
  { id: 'onedrive', label: 'OneDrive / SharePoint' },
];

// ── Folder picker dialog ──────────────────────────────────────────────────

interface FolderPickerDialogProps {
  projectId: string;
  connectionId: string;
  open: boolean;
  onClose: () => void;
  onFolderSelected: (conn: CloudSyncConnection) => void;
}

function FolderPickerDialog({
  projectId,
  connectionId,
  open,
  onClose,
  onFolderSelected,
}: FolderPickerDialogProps) {
  const { toast } = useToast();
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);

  const foldersQuery = useQuery({
    queryKey: ['drive-folders', connectionId, parentId],
    queryFn: () => listDriveFolders(connectionId, parentId),
    enabled: open,
    staleTime: 30_000,
  });

  const setFolderMutation = useMutation({
    mutationFn: (folder: FolderItem) =>
      setConnectionFolder(projectId, connectionId, {
        provider_folder_id: folder.id,
        provider_folder_name: folder.name,
      }),
    onSuccess: (conn) => {
      toast({ title: `Folder "${conn.provider_folder_name}" connected` });
      onFolderSelected(conn);
      onClose();
    },
    onError: (err) => {
      toast({
        title: 'Failed to set folder',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const navigateInto = (folder: FolderItem) => {
    setBreadcrumbs((bc) => [...bc, { id: folder.id, name: folder.name }]);
    setParentId(folder.id);
  };

  const navigateTo = (idx: number) => {
    const crumb = breadcrumbs[idx];
    setBreadcrumbs((bc) => bc.slice(0, idx + 1));
    setParentId(crumb?.id);
  };

  const navigateRoot = () => {
    setBreadcrumbs([]);
    setParentId(undefined);
  };

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setBreadcrumbs([]);
      setParentId(undefined);
    }
  }, [open]);

  const folders = foldersQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select a Google Drive folder</DialogTitle>
          <DialogDescription>
            Files added to this folder will sync automatically to the project's evidence chain every
            15 minutes.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb nav */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto">
          <button type="button" onClick={navigateRoot} className="hover:text-foreground shrink-0">
            My Drive
          </button>
          {breadcrumbs.map((bc, i) => (
            <span key={bc.id} className="flex items-center gap-1 shrink-0">
              <span>/</span>
              <button type="button" onClick={() => navigateTo(i)} className="hover:text-foreground">
                {bc.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="min-h-[200px] max-h-[360px] overflow-y-auto border border-border rounded">
          {foldersQuery.isPending ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading folders…
            </div>
          ) : foldersQuery.isError ? (
            <div className="flex items-center justify-center h-40 gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              Failed to load folders
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No sub-folders found
            </div>
          ) : (
            <ul>
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className="flex items-center border-b border-border last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => navigateInto(folder)}
                    className="flex-1 text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors truncate"
                  >
                    {folder.name}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mr-2 text-xs"
                    disabled={setFolderMutation.isPending}
                    onClick={() => setFolderMutation.mutate(folder)}
                  >
                    {setFolderMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      'Select'
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Drive tab — active connection list + connect button ───────────────────

interface DriveTabProps {
  projectId: string;
  connections: CloudSyncConnection[];
  pendingConnectionId: string | null;
  onConnect: () => void;
  onFolderSelected: (conn: CloudSyncConnection) => void;
  onDisconnect: (connectionId: string) => void;
  isConnecting: boolean;
}

function DriveTab({
  projectId,
  connections,
  pendingConnectionId,
  onConnect,
  onFolderSelected,
  onDisconnect,
  isConnecting,
}: DriveTabProps) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);

  // Open folder picker automatically when cs_pending is in the URL.
  useEffect(() => {
    if (pendingConnectionId && !folderPickerOpen) {
      setActivePendingId(pendingConnectionId);
      setFolderPickerOpen(true);
    }
  }, [pendingConnectionId, folderPickerOpen]);

  const activeConnections = connections.filter((c) => c.status === 'active');
  const pendingConnections = connections.filter((c) => c.status === 'pending_folder_selection');
  const errorConnections = connections.filter((c) => c.status === 'error');

  return (
    <div className="space-y-4">
      {/* Active connections */}
      {activeConnections.map((conn) => (
        <div
          key={conn.id}
          className="rounded border border-border bg-background px-3 py-3 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="text-sm font-medium">{conn.provider_folder_name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{conn.provider_account_email}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs text-destructive hover:text-destructive shrink-0"
              onClick={() => onDisconnect(conn.id)}
            >
              Disconnect
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>
              Files synced:{' '}
              <span className="font-medium text-foreground">{conn.files_synced_count}</span>
            </p>
            {conn.last_synced_at && (
              <p>
                Last sync:{' '}
                <span className="font-medium text-foreground">
                  {new Date(conn.last_synced_at).toLocaleString('en-AU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </p>
            )}
            {!conn.last_synced_at && (
              <p className="text-muted-foreground">Waiting for first sync (up to 15 min)</p>
            )}
          </div>
        </div>
      ))}

      {/* Pending folder selection */}
      {pendingConnections.map((conn) => (
        <div
          key={conn.id}
          className="rounded border border-border bg-secondary/30 px-3 py-3 flex items-center justify-between gap-2"
        >
          <div>
            <p className="text-sm font-medium">{conn.provider_account_email || 'Google Drive'}</p>
            <p className="text-xs text-muted-foreground">Folder not yet selected</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setActivePendingId(conn.id);
              setFolderPickerOpen(true);
            }}
          >
            Select folder
          </Button>
        </div>
      ))}

      {/* Error connections */}
      {errorConnections.map((conn) => (
        <div
          key={conn.id}
          className="rounded border border-destructive/40 bg-destructive/5 px-3 py-3 space-y-1"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              <span className="text-sm font-medium">
                {conn.provider_folder_name || 'Drive connection'}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs text-destructive hover:text-destructive shrink-0"
              onClick={() => onDisconnect(conn.id)}
            >
              Remove
            </Button>
          </div>
          {conn.last_sync_error && (
            <p className="text-xs text-destructive">{conn.last_sync_error}</p>
          )}
        </div>
      ))}

      {/* Connect button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onConnect}
        disabled={isConnecting}
        className="w-full"
      >
        {isConnecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Redirecting to Google…
          </>
        ) : (
          'Connect Google Drive'
        )}
      </Button>

      {/* Folder picker dialog */}
      {activePendingId && (
        <FolderPickerDialog
          projectId={projectId}
          connectionId={activePendingId}
          open={folderPickerOpen}
          onClose={() => {
            setFolderPickerOpen(false);
            setActivePendingId(null);
          }}
          onFolderSelected={onFolderSelected}
        />
      )}
    </div>
  );
}

// ── CloudSyncCard — provider tab switcher ─────────────────────────────────

function CloudSyncCard({ projectId }: { projectId: string }) {
  const [activeProvider, setActiveProvider] = useState<CloudProviderId>('gdrive');
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  // cs_pending is set by the OAuth callback redirect — open the folder picker.
  const csPending = searchParams.get('cs_pending');

  // Load connections.
  const connectionsQuery = useQuery({
    queryKey: ['cloud-sync-connections', projectId],
    queryFn: () => listCloudSyncConnections(projectId),
    staleTime: 30_000,
  });

  const connections = connectionsQuery.data ?? [];

  // Initiate Drive OAuth.
  const initiateMutation = useMutation({
    mutationFn: () => initiateGoogleDriveConnection(projectId),
    onSuccess: (res) => {
      // Redirect the browser to Google's consent screen.
      window.location.href = res.authorization_url;
    },
    onError: (err) => {
      toast({
        title: 'Failed to start Drive connection',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Disconnect a connection.
  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) => disconnectCloudSync(projectId, connectionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud-sync-connections', projectId] });
      toast({ title: 'Drive folder disconnected' });
    },
    onError: (err) => {
      toast({
        title: 'Failed to disconnect',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const handleFolderSelected = useCallback(
    (_conn: CloudSyncConnection) => {
      void qc.invalidateQueries({ queryKey: ['cloud-sync-connections', projectId] });
      // Clear the cs_pending query param now that the folder is selected.
      const url = new URL(window.location.href);
      url.searchParams.delete('cs_pending');
      router.replace(
        url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''),
      );
    },
    [qc, projectId, router],
  );

  const driveConnections = connections.filter((c) => c.provider === 'google_drive');

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="rounded bg-primary/10 p-2 text-primary">
            <Cloud className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Path 2
            </p>
            <h3 className="font-display text-lg font-medium">Cloud folder sync</h3>
          </div>
          {connectionsQuery.isFetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground mt-1" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Point a shared folder at this project — every file added to the folder mirrors into the
          project's evidence chain within minutes.
        </p>

        {/* Provider chooser */}
        <div className="flex flex-wrap gap-1 border-b border-border">
          {CLOUD_PROVIDERS.map((p) => {
            const isActive = p.id === activeProvider;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveProvider(p.id)}
                className={[
                  'inline-flex items-center px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Drive tab — live */}
        {activeProvider === 'gdrive' && (
          <DriveTab
            projectId={projectId}
            connections={driveConnections}
            pendingConnectionId={csPending}
            onConnect={() => initiateMutation.mutate()}
            onFolderSelected={handleFolderSelected}
            onDisconnect={(id) => disconnectMutation.mutate(id)}
            isConnecting={initiateMutation.isPending}
          />
        )}

        {/* Dropbox / OneDrive — pending */}
        {(activeProvider === 'dropbox' || activeProvider === 'onedrive') && (
          <div className="rounded bg-secondary/40 border border-border px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Status
            </p>
            <p className="text-xs">
              <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--brand-warning))] mr-2 align-middle" />
              Pending connector setup —{' '}
              {activeProvider === 'dropbox' ? 'Dropbox' : 'OneDrive / SharePoint'} OAuth integration
              ships in a separate connector sprint.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Direct upload card
// ─────────────────────────────────────────────────────────────────────────

function DirectUploadCard({ project }: { project: Project }) {
  return (
    <Card className="border-border lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="rounded bg-primary/10 p-2 text-primary">
            <Upload className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Path 3 · Live now
            </p>
            <h3 className="font-display text-lg font-medium">Direct upload from your computer</h3>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Drag and drop or pick a file. The browser computes a SHA-256 hash before upload, and the
          resulting event is attached to this project's claimant chain. PDFs, screenshots, lab
          notes, and signed contracts are common payloads.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <UploadEvidenceButton subjectTenantId={project.subject_tenant_id} />
          <span className="text-xs text-muted-foreground">
            Hash recorded · auditor can re-verify the file matches
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
