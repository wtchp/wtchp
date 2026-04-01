import { useAgeGate } from "../hooks/useAgeGate";

export function AgeGate() {
  const { verified, verify, deny } = useAgeGate();

  if (verified) return null;

  return (
    <div className="age-gate-overlay">
      <div className="age-gate-card">
        <div className="logo-large">WTCHP</div>
        <h2 style={{
          fontSize: "var(--font-size-xl)",
          fontWeight: 700,
          marginBottom: "var(--space-md)",
        }}>
          Age Verification Required
        </h2>
        <p>
          This website contains content that is only suitable for adults.
          By entering, you confirm that you are at least <strong>18 years old</strong> (or the age of majority in your jurisdiction).
        </p>
        <div className="age-gate-buttons">
          <button className="btn btn-primary btn-lg" onClick={verify}>
            I am 18 or older — Enter
          </button>
          <button className="btn btn-secondary btn-lg" onClick={deny}>
            Leave
          </button>
        </div>
        <p style={{
          marginTop: "var(--space-xl)",
          fontSize: "var(--font-size-xs)",
          color: "var(--text-tertiary)",
        }}>
          By entering this site, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
