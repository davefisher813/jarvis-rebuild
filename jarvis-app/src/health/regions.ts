// THE LIST BESIDE THE MAP (Health Push D, H-46, Dave's picks 2026-09-12).
// Twelve generic regions a person can name instead of tapping the map: a
// thumb on a bus, a screen reader, a spot the silhouette does not draw well.
// Each carries a synthetic coordinate on the same map, so a named region and
// a tapped one land in the same Still There? cluster (timelines.ts clusters by
// distance, and every region here sits more than SAME_SPOT_RADIUS from its
// neighbours). No intensity, no note, no diagnosis: a region is a place.
//
// Left and right are the PERSON's, the way a doctor asks. On the front view
// the person's left is the viewer's right, which is why Left Shoulder sits at
// x 0.65; the two back regions are centred and carry side "back".

export interface BodyRegion {
  label: string;
  x: number;
  y: number;
  side: "front" | "back";
}

export const BODY_REGIONS: BodyRegion[] = [
  { label: "Head", x: 0.5, y: 0.1, side: "front" },
  { label: "Neck", x: 0.5, y: 0.17, side: "front" },
  { label: "Left Shoulder", x: 0.65, y: 0.21, side: "front" },
  { label: "Right Shoulder", x: 0.35, y: 0.21, side: "front" },
  { label: "Upper Back", x: 0.5, y: 0.28, side: "back" },
  { label: "Lower Back", x: 0.5, y: 0.46, side: "back" },
  { label: "Left Hip", x: 0.565, y: 0.52, side: "front" },
  { label: "Right Hip", x: 0.435, y: 0.52, side: "front" },
  { label: "Left Knee", x: 0.565, y: 0.75, side: "front" },
  { label: "Right Knee", x: 0.435, y: 0.75, side: "front" },
  { label: "Left Ankle", x: 0.565, y: 0.93, side: "front" },
  { label: "Right Ankle", x: 0.435, y: 0.93, side: "front" },
];

export function regionByLabel(label: string): BodyRegion | null {
  return BODY_REGIONS.find((r) => r.label === label) ?? null;
}
