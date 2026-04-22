/**
 * Minimal layout for auth-flow pages (login, onboarding).
 * No main nav or sidebar — just the leftovers.gg logo, centred content.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <span className="font-brand text-base flex items-center" style={{ color: '#FFFFFF', fontWeight: 500, letterSpacing: '0.2px' }}>
          leftovers<span className="text-primary">.gg</span>
        </span>
      </div>
      {children}
    </div>
  );
}
