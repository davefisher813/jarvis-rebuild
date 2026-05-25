// Pure greeting + date helpers. Deterministic (no locale calls) so they test cleanly.

const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MO_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Morning < 12:00, Afternoon < 18:00, else Evening.
export function greetingFor(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

// "Wednesday, May 20"
export function longDate(now: Date = new Date()): string {
  return `${WD_LONG[now.getDay()]}, ${MO_LONG[now.getMonth()]} ${now.getDate()}`;
}

// "Thu, May 21"
export function shortDate(now: Date = new Date()): string {
  return `${WD_SHORT[now.getDay()]}, ${MO_SHORT[now.getMonth()]} ${now.getDate()}`;
}
