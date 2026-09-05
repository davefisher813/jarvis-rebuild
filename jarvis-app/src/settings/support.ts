// SHELL-F-19 (2026-09-05): the one support address, in one place. The in-app
// Support, Terms and Privacy screens shipped with "support@your-domain.com"
// on them, reachable from Sign In before an account exists, while the three
// pages in public/ already carried the real one. Three screens quoting the
// same address is exactly how they drift apart, so they quote this instead.
// Change it here and in public/terms.html, public/privacy.html and
// public/support.html together: those are static files this cannot reach.
export const SUPPORT_EMAIL = "davefisher813@gmail.com";
