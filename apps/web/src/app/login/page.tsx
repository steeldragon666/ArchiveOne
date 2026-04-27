import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Sign in to CPA Platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <a href="/v1/auth/microsoft/login">Continue with Microsoft</a>
          </Button>
          <Button asChild className="w-full" variant="outline">
            <a href="/v1/auth/google/login">Continue with Google</a>
          </Button>
          <p className="text-sm text-slate-500 text-center pt-2">
            Your firm administrator must add you to a firm before you can sign in.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
