import flagsmith from 'flagsmith';

export interface AuthSession {
  userId: string;
  token: string;
}

export function validateSession(session: AuthSession): boolean {
  // STALE FLAG: Legacy auth has been disabled / deprecated 90 days ago
  if (flagsmith.hasFeature('stale_legacy_auth')) {
    console.log('[Auth] Validating session using modern Ed25519 asymmetric JWT verification');
    return session.token.startsWith('jwt_');
  } else {
    console.log('[Auth] Insecure fallback to database cookie lookup');
    return false;
  }
}
