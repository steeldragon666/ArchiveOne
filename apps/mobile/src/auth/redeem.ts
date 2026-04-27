import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import type {
  MagicLinkRedeemBody,
  MagicLinkRedeemResponse,
} from '../api-client/types.js';

/**
 * Resolve the API base URL.
 *
 * Order:
 *   1. EXPO_PUBLIC_API_URL (explicit override; useful for dev / staging)
 *   2. app.json -> expo.extra.apiUrl (set per-build via EAS profiles)
 *   3. Hard fallback (prod hostname)
 */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromExtra = Constants.expoConfig?.extra?.apiUrl;
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  return 'https://platform.com.au';
}

/**
 * Per-device fingerprint used by the F8 refresh path to detect token
 * theft (refresh from a device different to redemption-time fails 403).
 *
 * iOS: keychain-backed identifierForVendor — stable per app install.
 * Android: ANDROID_ID — stable per app install + device.
 *
 * Both wipe on app reinstall. That's fine: the user just re-redeems
 * a fresh magic link, gets a new mobile_session, and continues.
 */
export async function getDeviceFingerprint(): Promise<string> {
  if (Platform.OS === 'ios') {
    const v = await Application.getIosIdForVendorAsync();
    return v ?? 'unknown-ios-vendor';
  }
  if (Platform.OS === 'android') {
    return Application.getAndroidId() ?? 'unknown-android-id';
  }
  // web fallback — useful for dev only
  return 'web-dev';
}

/**
 * POST /v1/auth/magic-link/redeem.
 *
 * Wraps the network call so the redeem screen can stay declarative.
 * Returns the typed response or throws (caller is responsible for
 * surfacing the error to the user).
 */
export async function redeemMagicLink(args: {
  token: string;
  pushToken?: string;
}): Promise<MagicLinkRedeemResponse> {
  const fingerprint = await getDeviceFingerprint();
  const body: MagicLinkRedeemBody = {
    token: args.token,
    device_fingerprint: fingerprint,
    ...(args.pushToken ? { push_token: args.pushToken } : {}),
  };

  const url = `${getApiBaseUrl()}/v1/auth/magic-link/redeem`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`magic-link redeem failed (${res.status}): ${text}`);
  }

  return (await res.json()) as MagicLinkRedeemResponse;
}
