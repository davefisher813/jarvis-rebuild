import { useAppearance } from "./appearance/AppearanceProvider";
import { useAuth } from "./auth/AuthProvider";
import SignIn from "./screens/SignIn";

// Routing for the slice so far:
//   not signed in (or no backend in sandbox) -> Sign In screen
//   signed in -> placeholder until the nav shell + features land
// The nav shell (tab bar + routing) and Notes are the next steps.
export default function App() {
  const { session, ready } = useAuth();
  const { appearance, toggleTheme } = useAppearance();

  if (!ready) return null;
  if (!session) return <SignIn />;

  // DEV PLACEHOLDER: signed-in landing until the real shell exists.
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.5 }}>
      <h1>Signed in</h1>
      <p>Theme: <strong>{appearance.theme}</strong></p>
      <button onClick={toggleTheme} style={{ padding: "8px 14px" }}>Toggle theme</button>
      <p style={{ opacity: 0.6, marginTop: 24 }}>
        Placeholder. Nav shell and features come next.
      </p>
    </div>
  );
}
