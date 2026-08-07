export interface PasswordStrength {
  score: number; // 0–4
  label: string;
  color: string;
  criteria: { label: string; met: boolean }[];
}

export function getPasswordStrength(pw: string): PasswordStrength {
  const criteria = [
    { label: "At least 8 characters", met: pw.length >= 8 },
    { label: "Uppercase letter (A–Z)", met: /[A-Z]/.test(pw) },
    { label: "Lowercase letter (a–z)", met: /[a-z]/.test(pw) },
    {
      label: "Number or symbol",
      met: /[0-9!@#$%^&*()_+\-=\[\]{}|;':\",./<>?`~\\]/.test(pw),
    },
  ];
  const score = criteria.filter((c) => c.met).length;
  const label =
    score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";
  const color =
    score <= 1
      ? "bg-red-500"
      : score === 2
      ? "bg-orange-400"
      : score === 3
      ? "bg-yellow-400"
      : "bg-green-500";
  return { score, label, color, criteria };
}

export function PasswordStrengthBar({ strength }: { strength: PasswordStrength }) {
  return (
    <div className="space-y-1.5 mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < strength.score ? strength.color : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Strength:{" "}
        <span className="font-medium text-foreground">{strength.label}</span>
      </p>
      <ul className="space-y-0.5">
        {strength.criteria.map((c) => (
          <li
            key={c.label}
            className={`flex items-center gap-1.5 text-xs ${
              c.met
                ? "text-green-600 dark:text-green-400"
                : "text-muted-foreground"
            }`}
          >
            <span className="shrink-0">{c.met ? "✓" : "○"}</span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
