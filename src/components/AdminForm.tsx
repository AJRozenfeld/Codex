export function Field({
  label,
  name,
  defaultValue,
  required,
  type = "text",
  className = "",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
      />
    </label>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  required,
  rows = 6,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        rows={rows}
        className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
      />
    </label>
  );
}

export function Select({
  label,
  name,
  defaultValue,
  options,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-widest text-ember/80 mb-1">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="w-full rounded-lg bg-void border border-gold/30 px-3 py-2 text-parchment focus:outline-none focus:border-gold/70"
      >
        <option value="">&mdash;</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-parchment/70">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="accent-gold" />
      {label}
    </label>
  );
}

export function RevealedToggle({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm rounded-lg border border-gold/30 bg-void/60 px-3 py-2">
      <input type="checkbox" name="revealed" defaultChecked={defaultChecked} className="accent-ember" />
      <span className="text-parchment">
        Revealed to players
        <span className="block text-xs text-parchment/40">Uncheck to keep this hidden from the public site.</span>
      </span>
    </label>
  );
}

export function CheckboxGroup({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  return (
    <fieldset className="block">
      <span className="block text-xs uppercase tracking-widest text-ember/80 mb-2">{label}</span>
      <div className="flex flex-wrap gap-3 max-h-48 overflow-y-auto rounded-lg border border-gold/20 p-3">
        {options.length === 0 && <span className="text-xs text-parchment/40">Nothing available yet.</span>}
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-xs text-parchment/70">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="accent-gold" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function BulkActionsBar({
  toggleAction,
  deleteAction,
  toggleLabel = "Reveal / Hide Selected",
}: {
  toggleAction?: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  toggleLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {toggleAction && (
        <button
          type="submit"
          formAction={toggleAction}
          className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-xs font-medium hover:bg-gold/10"
        >
          {toggleLabel}
        </button>
      )}
      <button
        type="submit"
        formAction={deleteAction}
        className="rounded-full border border-blood/50 text-blood px-4 py-1.5 text-xs font-medium hover:bg-blood/10"
      >
        Delete Selected
      </button>
      <span className="text-xs text-parchment/30">Check rows below, then choose an action.</span>
    </div>
  );
}

export function RowCheckbox({ id }: { id: string }) {
  return <input type="checkbox" name="ids" value={id} className="accent-gold" />;
}

export function FormActions({ deleteAction }: { deleteAction?: (formData: FormData) => void }) {
  return (
    <div className="flex items-center justify-between pt-4">
      <button type="submit" className="rounded-full bg-gold/90 text-ink px-5 py-2 text-sm font-medium hover:bg-gold">
        Save
      </button>
      {deleteAction && (
        <form action={deleteAction}>
          <button type="submit" className="text-sm text-blood hover:underline">Delete</button>
        </form>
      )}
    </div>
  );
}
