# Gondolin signature security

[CVE-2026-85393 / GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
is a `node-forge` RSA PKCS#1 v1.5 parser flaw: the `DigestInfo` validator ignored
extra children inside the nested `DigestAlgorithm`, allowing malformed
signatures. `node-forge` has no patched release.

## Current state

The optional Gondolin example now depends on `@earendil-works/gondolin` 0.14.0,
which no longer depends on `node-forge`. Gondolin builds its local MITM
certificates with its own DER encoder and verifies cached leaf certificates with
Node's `X509Certificate` (OpenSSL), so the affected parser is no longer on that
path. `npm audit --omit=dev` no longer reports Gondolin or `node-forge`.

OMK 1.4.0 through 1.5.8 shipped a temporary runtime guard (`signature-guard.ts`)
that patched Forge's ASN.1 validator before every VM start. It has been removed
together with the dependency it protected. Previously copied extension
directories should be replaced with the current example; upgrading the CLI alone
does not update those copies.

The scope is unchanged: this covers the OMK example's process. It does not cover
a separately launched `gondolin` CLI or another application. Keep certificate
caches private to their owner and do not import untrusted CA keys.

## Reproducible evidence

From `packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/gondolin-signature-regression.test.ts
```

The suite generates disposable RSA keys in memory (including exponent 3 from the
advisory) and builds certificates with Gondolin's own encoder. It replays the
malformed fixtures the former guard blocked against Gondolin's real cached-leaf
verification function, with no guard installed: a nested extra element with and
without NULL, a nested extra sequence, nonempty NULL, unterminated and
nonminimal OID, a mismatched digest OID, outer garbage and a corrupted signature
are all rejected. Each fixture is decrypted with the CA public key to confirm it
carries the intended structure, and a well-formed `DigestInfo` built the same way
verifies, so the rejections come from the structure alone. Normally issued
leaves verify and a foreign issuer is rejected. The suite also fails if
Gondolin's manifest or shipped sources reference `node-forge` again. A mocked VM
startup checks that the real extension reaches `VM.create`; no hypervisor or
network runs. These results cover this specific path; they do not prove the
absence of all vulnerabilities.

## Maintenance

If a future Gondolin release reintroduces `node-forge` or another ASN.1
signature parser, the regression suite fails. Review the dependency and its
advisory status before updating the test.
