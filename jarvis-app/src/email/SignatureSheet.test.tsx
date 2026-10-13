// @vitest-environment jsdom
// THE SIGNATURE BUILDER (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales. Enter your info and it creates a perfect
// signature." and "It should be super simple."). What this holds: an account with no signature opens the builder with its own
// address in as the email detail; a blank detail never appears; the preview is the email's own HTML; a picked picture is
// fitted by the app (no cropping, no size error), shown at once and uploaded only on Save into the person's own folder; the
// save sends the cleaned details and a reference to that picture; every failure leaves the sheet as it was and says why; the
// plain editor stays one tap away and saving typed words removes the picture; a typed signature opens the plain editor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SignatureSheet from "./SignatureSheet";
import { fitPicture, PictureUnreadable, type FittedPicture } from "./signaturePicture";
import { composeSignatureText, signatureCid, type SignatureFields, type SignatureImage } from "./signature";
import { sha256Hex } from "./drafts";
import type { EmailAccount, RpcClient } from "./emailClient";
import type { SignatureSaved } from "./signatureBus";
import type { FileStore } from "../files/FileStore";
import { resetToasts, subscribeToast, type ToastState } from "../shared/toast";

vi.mock("./signaturePicture", async (orig) => ({ ...(await orig<typeof import("./signaturePicture")>()), fitPicture: vi.fn() }));

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const USER = "u1";
const acct = (o: Partial<EmailAccount> = {}): EmailAccount => ({
  id: "a1", address: "dave@example.test", state: "connected", last_sync_at: null, sync_error: null, capabilities: { archive: true, trash: true, read: true },
  connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: "", signature_revision: 1, ...o,
});
const SAVED_IMAGE: SignatureImage = { storage_id: "u1/signature-a1/old-signature.png", sha256: "ab".repeat(32), size_bytes: 20000, mime_type: "image/png", width: 384, height: 256 };
const builtAcct = (o: Partial<EmailAccount> = {}) => acct({
  signature_text: "Dave Fisher\nBFFSA", signature_revision: 4, signature_kind: "built", signature_fields: { name: "Dave Fisher", organization: "BFFSA" }, signature_image: SAVED_IMAGE, ...o,
});

interface Rig {
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
  client: RpcClient;
  store: FileStore & { upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  saved: SignatureSaved[];
  closed: () => number;
}
function rig(o: { answer?: (fn: string, a: Record<string, unknown>) => unknown } = {}): Rig {
  const calls: Rig["calls"] = [];
  const client: RpcClient = { rpc: async (fn, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push({ fn, args: a });
    const custom = o.answer?.(fn, a);
    if (custom !== undefined) return { data: custom, error: null };
    if (fn === "email_signature_set") return { data: { account_id: a.p_account, signature_text: a.p_text, signature_revision: 5, signature_kind: "text", signature_fields: {}, signature_image: null }, error: null };
    if (fn === "email_signature_build_set") return { data: { account_id: a.p_account, signature_text: composeSignatureText(a.p_fields as SignatureFields), signature_revision: 5, signature_kind: "built", signature_fields: a.p_fields, signature_image: a.p_image }, error: null };
    return { data: null, error: null };
  } };
  const store = {
    upload: vi.fn(async (entity: string, file: File) => ({ path: `u1/${entity}/k1-${file.name}`, name: file.name, mime: file.type, bytes: file.size })),
    url: vi.fn(async (p: string) => "https://files.test/" + p),
    remove: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
  };
  return { calls, client, store, saved: [], closed: () => 0 };
}

let closes = 0;
const mount = (r: Rig, account: EmailAccount, withStore = true) => {
  closes = 0;
  return render(<SignatureSheet client={r.client} userId={USER} account={account} fileStore={withStore ? r.store : null} onClose={() => { closes++; }} onSaved={(_a, _t, _rev, saved) => { r.saved.push(saved); }} />);
};
// jsdom's File has no arrayBuffer(); give it the one the browser has.
const pngFile = (name = "signature.png"): File => {
  const f = new File([PNG], name, { type: "image/png" });
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.resolve(PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength)) });
  return f;
};
const fitted = (o: Partial<FittedPicture> = {}): FittedPicture => ({ file: pngFile(), mime: "image/png", width: 384, height: 256, ...o });
const pick = async (file = new File([PNG], "me.heic", { type: "image/heic" })) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
};
const srcdoc = () => document.querySelector("iframe.sig-paper")?.getAttribute("srcdoc") ?? "";
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const toasts: ToastState[] = [];
let unsub: () => void = () => {};

beforeEach(() => {
  vi.mocked(fitPicture).mockReset();
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fitted-1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  resetToasts();
  toasts.length = 0;
  unsub = subscribeToast((t) => { if (t) toasts.push(t); });
});
afterEach(() => { cleanup(); unsub(); vi.restoreAllMocks(); });

describe("the builder: an account with no signature", () => {
  it("opens with a picture step, six details and the address already in as the email, and nothing to crop or size", () => {
    mount(rig(), acct());
    expect(screen.getByText("Edit Signature")).toBeInTheDocument();
    expect(screen.getByText("Add Picture")).toBeInTheDocument();
    for (const label of ["Name", "Title", "Organization", "Phone", "Email", "Website"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("dave@example.test");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.queryByText(/crop|resize|too large|too big|megabyte/i)).toBeNull();
  });

  it("the preview is the email's own signature HTML: the filled details in order, a blank one absent, nothing from outside", () => {
    mount(rig(), acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Dave   Fisher " } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "BFFSA & Co" } });
    const doc = srcdoc();
    expect(doc).toContain(">Dave Fisher<");
    expect(doc).toContain("BFFSA &amp; Co");
    expect(doc.indexOf("Dave Fisher")).toBeLessThan(doc.indexOf("BFFSA"));
    expect(doc.indexOf("BFFSA")).toBeLessThan(doc.indexOf("dave@example.test"));
    expect(doc).not.toContain("<script");
    expect(doc).not.toContain("<img");
    expect(document.querySelector("iframe.sig-paper")).toHaveAttribute("sandbox", "allow-same-origin");
    // clearing a detail removes the line; the last one removes the preview altogether
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "" } });
    expect(srcdoc()).not.toContain("BFFSA");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
    expect(document.querySelector("iframe.sig-paper")).toBeNull();
  });

  it("Save sends only the filled details, cleaned, no picture, with the revision it saw; the sheet reports and closes", async () => {
    const r = rig();
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Dave\tFisher " } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(555) 010-0199" } });
    save();
    await waitFor(() => expect(closes).toBe(1));
    const call = r.calls.find((c) => c.fn === "email_signature_build_set")!;
    expect(call.args).toEqual({ p_owner: USER, p_account: "a1", p_fields: { name: "Dave Fisher", phone: "(555) 010-0199", email: "dave@example.test" }, p_image: null, p_expected_revision: 1 });
    expect(r.saved).toEqual([{ accountId: "a1", text: "Dave Fisher\n(555) 010-0199\ndave@example.test", revision: 5, kind: "built", fields: { name: "Dave Fisher", phone: "(555) 010-0199", email: "dave@example.test" }, image: null }]);
    expect(toasts.some((t) => t.message === "Signature Saved")).toBe(true);
    expect(r.store.upload).not.toHaveBeenCalled();
  });

  it("everything blank and no picture is the same as clearing the signature: the plain editor's empty save", async () => {
    const r = rig();
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.calls.map((c) => c.fn)).toEqual(["email_signature_set"]);
    expect(r.calls[0]!.args).toMatchObject({ p_text: "", p_expected_revision: 1 });
  });

  it("a refusal says why in the app's words and leaves the sheet open with everything typed", async () => {
    const r = rig({ answer: (fn) => (fn === "email_signature_build_set" ? { error: "SIGNATURE_CONFLICT", signature_revision: 7 } : undefined) });
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave Fisher" } });
    save();
    expect(await screen.findByText("Signature Changed Elsewhere · Reload and Try Again")).toBeInTheDocument();
    expect(closes).toBe(0);
    expect(screen.getByLabelText("Name")).toHaveValue("Dave Fisher");
    expect(r.saved).toEqual([]);
  });
});

describe("the picture", () => {
  it("is fitted by the app, shown at once as the thumbnail and in the preview, and uploaded only when Save is tapped", async () => {
    const r = rig();
    vi.mocked(fitPicture).mockResolvedValue(fitted());
    mount(r, acct());
    await pick();
    await waitFor(() => expect(screen.getByText("Change Picture")).toBeInTheDocument());
    expect(vi.mocked(fitPicture)).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".sig-pic-img")).toHaveAttribute("src", "blob:fitted-1");
    // the preview draws it at half its stored size, beside the lines
    expect(srcdoc()).toContain('<img src="blob:fitted-1" width="192" height="128"');
    expect(r.store.upload).not.toHaveBeenCalled();
    expect(r.calls).toEqual([]);
  });

  it("Save puts it in the person's own folder for this account and sends a reference with its size, type and hash", async () => {
    const r = rig();
    vi.mocked(fitPicture).mockResolvedValue(fitted());
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave Fisher" } });
    await pick();
    await waitFor(() => expect(screen.getByText("Change Picture")).toBeInTheDocument());
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.store.upload).toHaveBeenCalledTimes(1);
    expect(r.store.upload.mock.calls[0]![0]).toBe("signature-a1");
    const call = r.calls.find((c) => c.fn === "email_signature_build_set")!;
    const image = call.args.p_image as SignatureImage;
    expect(image).toEqual({ storage_id: "u1/signature-a1/k1-signature.png", sha256: await sha256Hex(PNG), size_bytes: PNG.byteLength, mime_type: "image/png", width: 384, height: 256 });
    expect(signatureCid(image.sha256)).toMatch(/^sig-[0-9a-f]{16}@jarvis\.local$/);
    expect(r.saved[0]!.image).toEqual(image);
  });

  it("a picture the browser cannot read is said in one line and changes nothing", async () => {
    const r = rig();
    vi.mocked(fitPicture).mockRejectedValue(new PictureUnreadable());
    mount(r, acct());
    await pick(new File(["not a picture"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("Couldn't Read That Picture · Try Another")).toBeInTheDocument();
    expect(screen.getByText("Add Picture")).toBeInTheDocument();
    expect(document.querySelector(".sig-pic-img")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("an upload that fails saves nothing and keeps the sheet", async () => {
    const r = rig();
    r.store.upload.mockRejectedValueOnce(new Error("offline"));
    vi.mocked(fitPicture).mockResolvedValue(fitted());
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave Fisher" } });
    await pick();
    await waitFor(() => expect(screen.getByText("Change Picture")).toBeInTheDocument());
    save();
    expect(await screen.findByText("Couldn't Save the Picture · Try Again")).toBeInTheDocument();
    expect(r.calls.some((c) => c.fn === "email_signature_build_set")).toBe(false);
    expect(closes).toBe(0);
  });

  it("a save the server refuses after the upload takes the uploaded file back out", async () => {
    const r = rig({ answer: (fn) => (fn === "email_signature_build_set" ? { error: "INVALID_PAYLOAD", detail: "image" } : undefined) });
    vi.mocked(fitPicture).mockResolvedValue(fitted());
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave Fisher" } });
    await pick();
    await waitFor(() => expect(screen.getByText("Change Picture")).toBeInTheDocument());
    save();
    expect(await screen.findByText("This Can't Be Saved as It Is")).toBeInTheDocument();
    expect(r.store.remove).toHaveBeenCalledWith(["u1/signature-a1/k1-signature.png"]);
    expect(closes).toBe(0);
  });

  it("a picture with no detail to go with it is said, and nothing is sent", async () => {
    const r = rig();
    vi.mocked(fitPicture).mockResolvedValue(fitted());
    mount(r, acct());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "" } });
    await pick();
    await waitFor(() => expect(screen.getByText("Change Picture")).toBeInTheDocument());
    expect(screen.getAllByText("Add a Detail to Go with the Picture")).toHaveLength(1);
    save();
    // Save's own line replaces the quiet note; it is never said twice.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Add a Detail to Go with the Picture"));
    expect(screen.getAllByText("Add a Detail to Go with the Picture")).toHaveLength(1);
    expect(r.calls).toEqual([]);
    expect(r.store.upload).not.toHaveBeenCalled();
  });

  it("without a place to keep it there is no picture step to tap", () => {
    mount(rig(), acct(), false);
    expect(screen.queryByText("Add Picture")).toBeNull();
    expect(screen.queryByText("Picture")).toBeNull();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});

describe("a saved built signature", () => {
  it("opens in the builder with its details and its picture, drawn from the person's own folder", async () => {
    const r = rig();
    mount(r, builtAcct());
    expect(screen.getByLabelText("Name")).toHaveValue("Dave Fisher");
    expect(screen.getByLabelText("Organization")).toHaveValue("BFFSA");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    await waitFor(() => expect(document.querySelector(".sig-pic-img")).toHaveAttribute("src", "https://files.test/u1/signature-a1/old-signature.png"));
    await waitFor(() => expect(srcdoc()).toContain('<img src="https://files.test/u1/signature-a1/old-signature.png" width="192" height="128"'));
    expect(screen.getByText("Change Picture")).toBeInTheDocument();
    expect(screen.getByText("Remove Picture")).toBeInTheDocument();
  });

  it("keeps the picture it already has when only a detail changes: same reference, nothing uploaded, nothing removed", async () => {
    const r = rig();
    mount(r, builtAcct());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Founder" } });
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.calls.find((c) => c.fn === "email_signature_build_set")!.args).toMatchObject({ p_image: SAVED_IMAGE, p_expected_revision: 4, p_fields: { name: "Dave Fisher", organization: "BFFSA", title: "Founder" } });
    expect(r.store.upload).not.toHaveBeenCalled();
    expect(r.store.remove).not.toHaveBeenCalled();
  });

  it("Remove Picture drops it from the signature, and the file goes only after the save worked", async () => {
    const r = rig();
    mount(r, builtAcct());
    fireEvent.click(screen.getByText("Remove Picture"));
    expect(screen.getByText("Add Picture")).toBeInTheDocument();
    expect(document.querySelector(".sig-pic-img")).toBeNull();
    expect(r.store.remove).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.calls.find((c) => c.fn === "email_signature_build_set")!.args.p_image).toBeNull();
    expect(r.store.remove).toHaveBeenCalledWith([SAVED_IMAGE.storage_id]);
    expect(r.saved[0]!.image).toBeNull();
  });

  it("a new picture replaces it, and the old file is removed after the save", async () => {
    const r = rig();
    vi.mocked(fitPicture).mockResolvedValue(fitted({ width: 200, height: 200 }));
    mount(r, builtAcct());
    await pick();
    await waitFor(() => expect(document.querySelector(".sig-pic-img")).toHaveAttribute("src", "blob:fitted-1"));
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect((r.calls.find((c) => c.fn === "email_signature_build_set")!.args.p_image as SignatureImage).storage_id).toBe("u1/signature-a1/k1-signature.png");
    expect(r.store.remove).toHaveBeenCalledWith([SAVED_IMAGE.storage_id]);
  });
});

describe("the plain editor stays", () => {
  it("a typed signature opens the plain editor, and Use the Signature Builder starts a builder with the address in", () => {
    mount(rig(), acct({ signature_text: "Dave F.\nWork" }));
    expect(screen.getByText("Edit Signature")).toBeInTheDocument();
    expect(screen.getByLabelText("Signature")).toHaveValue("Dave F.\nWork");
    fireEvent.click(screen.getByRole("button", { name: "Use the Signature Builder" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("dave@example.test");
  });

  it("Write It Yourself starts from the lines just built, and saving typed words is the plain door, which takes the picture with it", async () => {
    const r = rig();
    mount(r, builtAcct());
    fireEvent.click(screen.getByRole("button", { name: "Write It Yourself" }));
    expect(screen.getByLabelText("Signature")).toHaveValue("Dave Fisher\nBFFSA");
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "Dave Fisher\nBFFSA\nBy hand" } });
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.calls.map((c) => c.fn)).toEqual(["email_signature_set"]);
    expect(r.calls[0]!.args).toMatchObject({ p_text: "Dave Fisher\nBFFSA\nBy hand", p_expected_revision: 4 });
    expect(r.store.remove).toHaveBeenCalledWith([SAVED_IMAGE.storage_id]);
    expect(r.saved).toEqual([{ accountId: "a1", text: "Dave Fisher\nBFFSA\nBy hand", revision: 5, kind: "text", fields: {}, image: null }]);
  });

  it("the plain editor's empty save still clears the signature", async () => {
    const r = rig();
    mount(r, acct({ signature_text: "Old words" }));
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "" } });
    save();
    await waitFor(() => expect(closes).toBe(1));
    expect(r.calls[0]!.args).toMatchObject({ p_text: "" });
  });
});
