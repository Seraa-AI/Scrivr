import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Scrivr, StarterKit, defaultPageConfig, useScrivrEditor } from "@scrivr/react";
import {
  DefaultContent,
  Editor,
  Field,
  ServerEditor,
  hashArtifact,
  listSignerFields,
  verifySnapshot,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { FieldCompletion, ReadingProgress, requestField, type ReadingEvent } from "@scrivr/plugins";
import { exportToPdf } from "@scrivr/export-pdf";
import { playgroundFonts } from "./fonts";
import { PLAYGROUND_THEME } from "./theme";
import { ROLE_LABEL, SIGNING_ROLES, type SigningRole } from "./signingDemo";
import { RoleLegend } from "./FieldInsertMenu";

/** A field the signer pressed, waiting for the value they give. */
interface FieldRequest {
  field: SignerFieldDescriptor;
  /** What the field holds now, when the signer is changing it. */
  current: FieldValue | undefined;
  resolve: (value: FieldValue | null) => void;
}

interface Reading {
  furthest: number;
  reachedEnd: boolean;
}

const KIND_LABEL: Record<string, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  dateSigned: "Date signed",
  name: "Name",
  title: "Title",
  email: "Email",
  checkbox: "Agreement",
  dropdown: "Payment terms",
};

const shortHash = (hash: string) => `${hash.slice(0, 15)}…${hash.slice(-6)}`;

/**
 * A sealed revision being signed, as a signing host would run it: each party
 * opens the same snapshot, completes only their own fields, and every value
 * stays here — outside the document — until the executed PDF prints them.
 */
export function SigningRoom({ snapshot, onBack }: { snapshot: SealedSnapshot; onBack: () => void }) {
  const [role, setRole] = useState<SigningRole>("client");
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [reading, setReading] = useState<Record<SigningRole, Reading>>({
    provider: { furthest: 0, reachedEnd: false },
    client: { furthest: 0, reachedEnd: false },
  });
  const [request, setRequest] = useState<FieldRequest | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [executed, setExecuted] = useState<{ hash: string; url: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The editor reads these once, when it is created for a role.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Signing only goes ahead on the bytes that were sealed: their hash must
  // match, and the fields offered must be the ones those bytes hold.
  useEffect(() => {
    let current = true;
    void verifySnapshot(snapshot.content, snapshot.contentHash).then((intact) => {
      const held = listSignerFields(new ServerEditor({ extensions: [StarterKit, Field], content: JSON.parse(snapshot.content) }).getState().doc);
      if (current) setVerified(intact && JSON.stringify(held) === JSON.stringify(snapshot.fields));
    });
    return () => {
      current = false;
    };
  }, [snapshot]);

  useEffect(() => () => {
    if (executed) URL.revokeObjectURL(executed.url);
  }, [executed]);

  const content = useMemo(() => JSON.parse(snapshot.content), [snapshot]);
  const mine = snapshot.fields.filter((f) => f.role === role);

  const editor = useScrivrEditor(
    {
      sealed: true,
      pageConfig: defaultPageConfig,
      theme: PLAYGROUND_THEME,
      fonts: playgroundFonts,
      themeRoot: typeof document !== "undefined" ? document.documentElement : undefined,
      extensions: [
        StarterKit.configure({ table: true }),
        // Opens with what every party has given so far: the room's record.
        Field.configure({ values: valuesRef.current }),
        DefaultContent.configure({ json: content }),
        FieldCompletion.configure({
          fields: snapshot.fields,
          // Nothing is offered until the snapshot is proven intact.
          completable: verified ? mine.map((f) => f.id) : [],
          onFieldRequest: (field, current) =>
            new Promise<FieldValue | null>((resolve) => {
              // A click ticks the box, and a second click clears it.
              if (field.kind === "checkbox") {
                return resolve({ kind: "checkbox", checked: !(current?.kind === "checkbox" && current.checked) });
              }
              // Dated as the party signs: a real host takes the date from its own record of the signature.
              if (field.kind === "dateSigned") {
                return resolve({ kind: "text", text: new Date().toLocaleDateString(undefined, { dateStyle: "long" }) });
              }
              setRequest({ field, current, resolve });
            }).then((value) => {
              setProblem(null);
              if (value) setValues((all) => ({ ...all, [field.id]: value }));
              return value;
            }),
          onFieldRequestError: (field, error) =>
            setProblem(`${KIND_LABEL[field.kind] ?? field.kind} could not be completed: ${error instanceof Error ? error.message : String(error)}. Try again.`),
        }),
        ReadingProgress.configure({
          onReading: (event: ReadingEvent) => {
            if (event.type !== "furthestPage" && event.type !== "reachedEnd") return;
            setReading((all) => ({
              ...all,
              [role]:
                event.type === "furthestPage"
                  ? { ...all[role], furthest: Math.max(all[role].furthest, event.page) }
                  : { ...all[role], reachedEnd: true },
            }));
          },
        }),
      ],
    },
    [role, verified],
  );

  const pageCount = editor?.layout.pages.length ?? 0;
  const missing = snapshot.fields.filter((f) => f.required && !values[f.id]);
  const nextOpen = mine.find((f) => !values[f.id] && f.kind !== "dateSigned");

  const answer = (value: FieldValue | null) => {
    request?.resolve(value);
    setRequest(null);
    // Back to the page, so Tab carries on from this field.
    editor?.focus();
  };
  const open = (id: string) => {
    if (editor) requestField(editor, id);
  };

  const exportExecuted = async () => {
    if (!verified) return;
    setExporting(true);
    setProblem(null);
    // The executed document is the sealed snapshot with the values printed in
    // their fields — rendered by an editor of its own, never by editing this one.
    const printer = new Editor({
      sealed: true,
      pageConfig: defaultPageConfig,
      fonts: playgroundFonts,
      extensions: [StarterKit.configure({ table: true }), Field.configure({ values }), DefaultContent.configure({ json: content })],
    });
    try {
      const bytes = await exportToPdf(printer);
      const hash = await hashArtifact(bytes);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      setExecuted({ hash, url });
      const link = document.createElement("a");
      link.href = url;
      link.download = "services-agreement-executed.pdf";
      link.click();
    } catch (error) {
      setProblem(`The executed PDF could not be made: ${error instanceof Error ? error.message : String(error)}. Try again.`);
    } finally {
      printer.destroy();
      setExporting(false);
    }
  };

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Keyed by role: each party opens the document at its start, as they would. */}
      <main key={role} className="min-w-0 flex-1 overflow-auto p-2 md:p-4">
        {verified === false && (
          <div role="alert" className="mx-auto mb-3 max-w-[794px] rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: "#dc2626", color: "#dc2626" }}>
            This copy is not what was sealed — its hash or its fields differ. Signing and the executed PDF are off.
          </div>
        )}
        {problem && (
          <div role="alert" className="mx-auto mb-3 max-w-[794px] rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: "var(--app-border)", color: "var(--app-text)" }}>
            {problem}
          </div>
        )}
        <div className="flex min-w-max justify-center">
          <div className="relative shrink-0" style={{ width: defaultPageConfig.pageWidth }}>
            <Scrivr
              editor={editor}
              style={{ width: defaultPageConfig.pageWidth }}
              pageStyle={{
                border: "1px solid var(--scrivr-page-border)",
                background: "var(--scrivr-page-bg)",
                boxShadow: "none",
              }}
            />
          </div>
        </div>
      </main>

      <aside
        className="hidden shrink-0 flex-col gap-4 overflow-y-auto border-l p-4 text-[12px] md:flex"
        style={{ width: 340, borderColor: "var(--app-border)", background: "var(--app-surface)" }}
      >
        <RoleLegend />
        <Section title="Signing as">
          <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" style={{ borderColor: "var(--app-border)" }}>
            {SIGNING_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className="h-8 rounded-md text-[12px] font-semibold"
                style={
                  r === role
                    ? { background: "var(--app-accent-soft-bg)", color: "var(--app-accent-soft-fg)" }
                    : { color: "var(--app-text-muted)" }
                }
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <p className="mt-2 leading-snug" style={{ color: "var(--app-text-muted)" }}>
            Fields drawn solid in your colour are yours. Click one to complete it, or press Tab to move between them and
            Enter to open one. Click a completed field to change it.
          </p>
          <button
            type="button"
            disabled={!nextOpen}
            onClick={() => nextOpen && open(nextOpen.id)}
            className="mt-2 h-8 w-full rounded-md border text-[12px] font-semibold disabled:opacity-50"
            style={{ background: "var(--app-accent)", borderColor: "var(--app-accent)", color: "var(--app-accent-fg)" }}
          >
            {nextOpen ? `Next field: ${KIND_LABEL[nextOpen.kind] ?? nextOpen.kind}` : "All your fields are complete"}
          </button>
        </Section>

        <Section title={`${ROLE_LABEL[role]}'s fields`}>
          <ul className="flex flex-col gap-1">
            {mine.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => open(f.id)}
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--app-accent-soft-bg)]"
                >
                  <span>
                    {KIND_LABEL[f.kind] ?? f.kind}
                    {!f.required && <span style={{ color: "var(--app-text-muted)" }}> (optional)</span>}
                  </span>
                  <span style={{ color: values[f.id] ? "var(--app-accent)" : "var(--app-text-muted)" }}>
                    {values[f.id] ? describe(values[f.id]!, f) : f.kind === "dateSigned" ? "When you sign" : "Open"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Reading">
          <Row label="Furthest page">
            {reading[role].furthest} of {pageCount}
          </Row>
          <Row label="Reached the end">{reading[role].reachedEnd ? "Yes" : "Not yet"}</Row>
        </Section>

        <Section title="Sealed revision">
          <Row label="Content hash">
            <code title={snapshot.contentHash}>{shortHash(snapshot.contentHash)}</code>
          </Row>
          <Row label="Snapshot intact">{verified === null ? "Checking…" : verified ? "Yes" : "No — it changed"}</Row>
          <Row label="Required fields left">{missing.length}</Row>
        </Section>

        <Section title="Executed document">
          <button
            type="button"
            disabled={!verified || missing.length > 0 || exporting}
            onClick={() => void exportExecuted()}
            className="h-8 w-full rounded-md border text-[12px] font-semibold disabled:opacity-50"
            style={{ background: "var(--app-accent)", borderColor: "var(--app-accent)", color: "var(--app-accent-fg)" }}
          >
            {exporting ? "Rendering…" : "Download executed PDF"}
          </button>
          {missing.length > 0 && (
            <p className="mt-2" style={{ color: "var(--app-text-muted)" }}>
              Available once every party has completed their required fields.
            </p>
          )}
          {executed && (
            <Row label="PDF hash">
              <a href={executed.url} target="_blank" rel="noreferrer">
                <code title={executed.hash}>{shortHash(executed.hash)}</code>
              </a>
            </Row>
          )}
        </Section>

        <button
          type="button"
          onClick={onBack}
          className="h-8 rounded-md border text-[12px] font-medium"
          style={{ borderColor: "var(--app-border)", color: "var(--app-text)" }}
        >
          Back to editing
        </button>
      </aside>

      {request && <ValueDialog field={request.field} current={request.current} onAnswer={answer} />}
    </div>
  );
}

function describe(value: FieldValue, field: SignerFieldDescriptor): string {
  if (value.kind === "text") return value.text;
  if (value.kind === "choice") return field.options.find((choice) => choice.id === value.id)?.label ?? value.id;
  if (value.kind === "image") return "Drawn";
  return value.checked ? "Ticked" : "Unticked";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span style={{ color: "var(--app-text-muted)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** What a host shows when a signer presses a field: capture the value, or cancel. */
function ValueDialog({
  field,
  current,
  onAnswer,
}: {
  field: SignerFieldDescriptor;
  current: FieldValue | undefined;
  onAnswer: (value: FieldValue | null) => void;
}) {
  const drawn = field.kind === "signature" || field.kind === "initials";
  const [typed, setTyped] = useState(() => {
    if (current?.kind === "text") return current.text;
    if (current?.kind === "choice") return current.id;
    if (field.kind === "date") return new Date().toISOString().slice(0, 10);
    return field.kind === "dropdown" ? (field.options[0]?.id ?? "") : "";
  });
  const pad = useRef<HTMLCanvasElement>(null);
  const [inked, setInked] = useState(false);

  const submit = () => {
    if (drawn && inked && pad.current) return onAnswer({ kind: "image", src: pad.current.toDataURL("image/png") });
    if (field.kind === "dropdown") onAnswer({ kind: "choice", id: typed });
    else if (typed.trim()) onAnswer({ kind: "text", text: typed.trim() });
  };

  // Esc cancels and Enter applies, wherever focus is in the dialog.
  const keys = useRef({ submit, onAnswer });
  keys.current = { submit, onAnswer };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") keys.current.onAnswer(null);
      else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        keys.current.submit();
      } else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
      <div
        role="dialog"
        aria-label={KIND_LABEL[field.kind] ?? field.kind}
        className="w-[400px] rounded-lg border p-4 text-[13px] shadow-xl"
        style={{ background: "var(--app-surface)", borderColor: "var(--app-border)", color: "var(--app-text)" }}
      >
        <div className="mb-3 font-semibold">
          {KIND_LABEL[field.kind] ?? field.kind} — {ROLE_LABEL[field.role] ?? field.role}
        </div>

        {drawn && current?.kind === "image" && !inked && (
          <p className="mb-2" style={{ color: "var(--app-text-muted)" }}>
            Signed already — draw again to replace it.
          </p>
        )}
        {drawn && <SignaturePad canvas={pad} onInk={() => setInked(true)} />}

        {field.kind === "dropdown" ? (
          <select
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-9 w-full rounded-md border px-2"
            style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
          >
            {field.options.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus={!drawn}
            type={field.kind === "date" ? "date" : field.kind === "email" ? "email" : "text"}
            placeholder={drawn ? "…or type it" : KIND_LABEL[field.kind] ?? field.kind}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border px-2"
            style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onAnswer(null)} className="h-8 rounded-md border px-3" style={{ borderColor: "var(--app-border)" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!(drawn && inked) && !typed.trim()}
            className="h-8 rounded-md border px-3 font-semibold disabled:opacity-50"
            style={{ background: "var(--app-accent)", borderColor: "var(--app-accent)", color: "var(--app-accent-fg)" }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function SignaturePad({ canvas, onInk }: { canvas: RefObject<HTMLCanvasElement | null>; onInk: () => void }) {
  const drawing = useRef(false);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvas}
      width={366}
      height={120}
      className="block w-full cursor-crosshair touch-none rounded-md border"
      style={{ borderColor: "var(--app-border)", background: "#fff" }}
      onPointerDown={(e) => {
        const ctx = e.currentTarget.getContext("2d");
        if (!ctx) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const { x, y } = point(e);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#111827";
        ctx.beginPath();
        ctx.moveTo(x, y);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext("2d");
        const { x, y } = point(e);
        ctx?.lineTo(x, y);
        ctx?.stroke();
        onInk();
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
    />
  );
}
