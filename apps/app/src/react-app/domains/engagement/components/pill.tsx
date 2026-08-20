/** @jsxImportSource react */

const TONES = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  gap: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
} as const;

export function Pill({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
