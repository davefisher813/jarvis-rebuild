import { useState } from "react";
import MorePage, { type MoreRoute } from "./MorePage";
import ProfilePage from "../settings/ProfilePage";
import AppearancePage from "../settings/AppearancePage";
import SettingsPage from "./SettingsPage";
import AccountPage from "../settings/AccountPage";
import NotificationsPage from "../settings/NotificationsPage";
import AboutPage from "../settings/AboutPage";
import AdvancedPage from "../settings/AdvancedPage";
import BackupPage from "../settings/BackupPage";
import TermsPage from "../settings/TermsPage";
import PrivacyPage from "../settings/PrivacyPage";
import SupportPage from "../settings/SupportPage";
import CategoriesFlow from "../categories/CategoriesFlow";
import ConnectionsPage from "../connections/ConnectionsPage";
import EditTabsPage from "./EditTabsPage";
import type { Destination } from "../shell/destinations";
import AdminPanel from "../admin/AdminPanel";
import { createAdminApi, makeSampleAdminSource } from "../admin/AdminService";
import { useIsAdmin } from "../admin/useIsAdmin";
import { useAuth } from "../auth/AuthProvider";
import { backendConfigured } from "../data/store";

// The More tab: a hub of the pages not in the tab bar (extras), plus the
// More-only screens (Edit Tabs and Settings). Feature extras are opened by the
// shell (onOpenExtra) so they render full-screen with the dock; settings screens
// stay inside More with a back button.
export default function MoreFlow({
  extras,
  onOpenExtra,
  tabKeys,
  onToggleTab,
  onReorderTabs,
  onSignOut,
}: {
  extras: Destination[];
  onOpenExtra: (key: string) => void;
  tabKeys: string[];
  onToggleTab: (key: string) => void;
  onReorderTabs?: (next: string[]) => void;
  onSignOut?: () => void;
}) {
  const isAdmin = useIsAdmin();
  const { session } = useAuth();
  const canAdmin = !backendConfigured || isAdmin;
  const adminSource = backendConfigured
    ? createAdminApi(session?.access_token || "")
    : makeSampleAdminSource();
  const [route, setRoute] = useState<"hub" | MoreRoute | "terms" | "privacy" | "support" | "admin">("hub");

  const screen = (() => {
  if (route === "settings") return <SettingsPage onNavigate={(r) => setRoute(r)} onBack={() => setRoute("hub")} />;
  if (route === "profile") return <ProfilePage onBack={() => setRoute("account")} />;
  if (route === "appearance") return <AppearancePage onBack={() => setRoute("settings")} />;
  if (route === "categories") return <CategoriesFlow onBack={() => setRoute("settings")} />;
  if (route === "connections") return <ConnectionsPage onBack={() => setRoute("settings")} />;
  if (route === "edittabs") return <EditTabsPage tabKeys={tabKeys} onToggle={onToggleTab} onReorder={onReorderTabs} onBack={() => setRoute("settings")} />;
  if (route === "account") return <AccountPage onBack={() => setRoute("settings")} onEditProfile={() => setRoute("profile")} onSignOut={onSignOut} />;
  if (route === "notifsettings") return <NotificationsPage onBack={() => setRoute("settings")} />;
  if (route === "about") return <AboutPage onBack={() => setRoute("settings")} onTerms={() => setRoute("terms")} onPrivacy={() => setRoute("privacy")} onSupport={() => setRoute("support")} onSecret={canAdmin ? () => setRoute("admin") : undefined} />;
  if (route === "admin") return <AdminPanel isAdmin={canAdmin} source={adminSource} onBack={() => setRoute("settings")} />;
  if (route === "terms") return <TermsPage onBack={() => setRoute("about")} />;
  if (route === "privacy") return <PrivacyPage onBack={() => setRoute("about")} />;
  if (route === "support") return <SupportPage onBack={() => setRoute("about")} />;
  if (route === "advanced") return <AdvancedPage onBack={() => setRoute("settings")} />;
  if (route === "backup") return <BackupPage onBack={() => setRoute("settings")} />;

  return <MorePage extras={extras} onOpenExtra={onOpenExtra} onNavigate={(r) => setRoute(r)} />;
  })();

  return <div className="route-push" key={route}>{screen}</div>;
}
