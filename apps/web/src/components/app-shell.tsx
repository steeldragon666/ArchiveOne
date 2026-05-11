'use client';
/**
 * AppShell — the consistent chrome wrapping every authenticated page in the
 * Claimsure platform. Provides the header (logo, tenant switcher, user menu)
 * and the persistent left navigation, so individual pages only render their
 * content area.
 *
 * Pages opt in by wrapping their content:
 *
 *   export default function MyPage() {
 *     return <AppShell><PageContent /></AppShell>;
 *   }
 *
 * AppShell embeds AuthGuard internally — the page does not need to (and
 * should not) wrap itself with both. If the user is not authenticated,
 * AuthGuard handles the redirect to /login. AppShell itself only renders
 * after a successful whoami response.
 *
 * Design system reference: docs/design/system.md.
 * Tokens applied via globals.css custom properties:
 *   - bg-background    cream paper
 *   - text-foreground  warm near-black ink
 *   - border-border    hairline beige
 *   - text-primary     patina green for active nav state
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Workflow,
  FolderOpen,
  Building2,
  Sparkles,
  Radio,
  Users,
  Boxes,
  SlidersHorizontal,
  Palette,
  Receipt,
  LogOut,
  ChevronRight,
  Beaker,
  Wallet,
} from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { Button } from '@/components/ui/button';
import { useWhoami } from '@/hooks/use-whoami';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WORKSPACE_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: Workflow },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/subject-tenants', label: 'Client firms', icon: Building2 },
  { href: '/suggestions', label: 'Suggestions', icon: Sparkles },
  { href: '/intelligence', label: 'Intelligence', icon: Radio },
  { href: '/finance', label: 'Finance', icon: Wallet },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/users', label: 'Firm members', icon: Users },
  { href: '/tenants', label: 'Tenants', icon: Boxes },
  { href: '/admin/apportionment', label: 'Apportionment', icon: SlidersHorizontal },
  { href: '/admin/brand-config', label: 'Brand', icon: Palette },
  { href: '/admin/billing/invoices', label: 'Billing', icon: Receipt },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppShellInner>{children}</AppShellInner>
    </AuthGuard>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { data } = useWhoami();
  if (!data) return null;

  const isAdmin = data.user.role === 'admin';

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header
        availableTenants={data.availableTenants}
        activeTenantId={data.user.tenantId}
        userEmail={data.user.email}
      />
      <div className="flex flex-1">
        <Sidebar isAdmin={isAdmin} />
        <main className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}

function Header({
  availableTenants,
  activeTenantId,
  userEmail,
}: {
  availableTenants: {
    tenantId: string;
    name: string;
    slug: string;
    role: 'admin' | 'consultant' | 'viewer';
    isDefault: boolean;
  }[];
  activeTenantId: string | null;
  userEmail: string;
}) {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="flex items-center justify-between gap-4 px-6 h-14">
        <Link href="/" className="flex items-baseline gap-2 group">
          <span className="font-display text-xl font-semibold tracking-tight">Claimsure</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
            R&amp;D Tax Incentive
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <TenantSwitcher tenants={availableTenants} activeTenantId={activeTenantId} />
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground border-l border-border ml-1">
            <span className="font-mono text-xs">{userEmail}</span>
          </div>
          <SignoutButton />
        </div>
      </div>
    </header>
  );
}

function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-border bg-secondary/40">
      <nav className="flex-1 py-6 px-3 space-y-6">
        <NavSection label="Workspace" items={WORKSPACE_NAV} />
        {isAdmin && <NavSection label="Administration" items={ADMIN_NAV} />}
      </nav>
      <div className="border-t border-border p-3">
        <Link
          href="/styleguide"
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-sm transition-colors"
        >
          <Beaker className="h-3.5 w-3.5" />
          Styleguide
          <ChevronRight className="h-3 w-3 ml-auto" />
        </Link>
      </div>
    </aside>
  );
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div>
      <h3 className="px-3 mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm transition-colors',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SignoutButton() {
  const handleSignout = () => {
    void fetch('/v1/auth/signout', {
      method: 'POST',
      credentials: 'include',
    }).then(() => {
      window.location.href = '/login';
    });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleSignout}
      className="text-muted-foreground hover:text-foreground"
    >
      <LogOut className="h-4 w-4 mr-1.5" />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
