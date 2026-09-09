// UP-LAUNCH-13: Subscription tier system.
// The server-authoritative fact about the user's subscription level:
// - 'god': unlimited access and AI usage (developer/founder tier)
// - 'paid': active subscription (full feature set, AI cost limits apply)
// - 'free': trial or free tier (limited features, low AI usage allowance)

export type SubscriptionTier = 'god' | 'paid' | 'free';

export const DEFAULT_TIER: SubscriptionTier = 'free';

// Validate a tier value.
export function isValidTier(value: string): value is SubscriptionTier {
  return value === 'god' || value === 'paid' || value === 'free';
}

// Tier-gating predicates. Used by the app to decide what's available.
export function isTierPaid(tier: SubscriptionTier): boolean {
  return tier === 'paid' || tier === 'god';
}

export function isTierUnlimited(tier: SubscriptionTier): boolean {
  return tier === 'god';
}

// Tier display name (for admin UI, debugging).
export function tierDisplayName(tier: SubscriptionTier): string {
  switch (tier) {
    case 'god':
      return 'God (Unlimited)';
    case 'paid':
      return 'Paid';
    case 'free':
      return 'Free';
  }
}
