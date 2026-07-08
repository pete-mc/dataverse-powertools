// Certificate handling for the certificate-based service-principal auth flow.
// Turns a PEM bundle (private key + X.509 certificate) into the pieces MSAL's
// clientCertificate config needs. The pure formatting logic is unit-tested; the
// thin node-crypto parsing wrappers are not (they're standard-library calls).

import * as crypto from "crypto";
import * as fs from "fs";

export interface CertificateCredential {
  /** PKCS#8 PEM private key. */
  privateKey: string;
  /** SHA-1 thumbprint, 40-char uppercase hex, as MSAL's clientCertificate expects. */
  thumbprint: string;
}

/**
 * Normalise an X.509 SHA-1 fingerprint (e.g. "E9:FB:66:…" from
 * crypto.X509Certificate.fingerprint) to the bare uppercase hex form MSAL wants.
 * Pure; the character class strips colons and any other non-hex separators.
 */
export function formatThumbprint(fingerprint: string | undefined | null): string {
  return (fingerprint ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

/**
 * Parse a PEM bundle containing a private key and a certificate into MSAL cert
 * credentials. Throws if the PEM is missing either block or the passphrase is wrong.
 */
export function parsePemCertificate(pem: string, passphrase?: string): CertificateCredential {
  const cert = new crypto.X509Certificate(pem);
  const keyObject = passphrase ? crypto.createPrivateKey({ key: pem, passphrase }) : crypto.createPrivateKey(pem);
  const privateKey = keyObject.export({ type: "pkcs8", format: "pem" }).toString();
  return { privateKey, thumbprint: formatThumbprint(cert.fingerprint) };
}

/** Read a PEM certificate/key bundle from disk and parse it. */
export async function loadCertificate(filePath: string, passphrase?: string): Promise<CertificateCredential> {
  const pem = await fs.promises.readFile(filePath, "utf8");
  return parsePemCertificate(pem, passphrase);
}
