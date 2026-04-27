import { Redirect, Stack } from 'expo-router';
import { useSessionStore } from '../../src/auth/session-store.js';

export default function AuthedLayout() {
  const session = useSessionStore((s) => s.session);
  if (!session) return <Redirect href="/(unauthed)/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
