// THE GREETING'S ONE SERIF (Dave 2026-10-11, visual catalog, Greeting). "Good" keeps the app's sans at its weight and
// the time of day (Morning, Afternoon, Evening) is set in Newsreader italic 500 (.greet-when, components.css). Anything
// after it (", Dave") stays in the sans. A greeting that is not "Good <time>" renders as it is.
const SHAPE = /^(Good )(Morning|Afternoon|Evening)(.*)$/;

export default function GreetingWords({ greeting }: { greeting: string }) {
  const m = SHAPE.exec(greeting);
  if (!m) return <>{greeting}</>;
  return <>{m[1]}<span className="greet-when">{m[2]}</span>{m[3]}</>;
}
