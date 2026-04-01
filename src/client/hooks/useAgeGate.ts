import { useState, useEffect } from "react";

export function useAgeGate() {
  const [verified, setVerified] = useState(true); // Default true to prevent flash

  useEffect(() => {
    const stored = localStorage.getItem("age_verified");
    setVerified(stored === "true");
  }, []);

  const verify = () => {
    localStorage.setItem("age_verified", "true");
    setVerified(true);
  };

  const deny = () => {
    window.location.href = "https://google.com";
  };

  return { verified, verify, deny };
}
