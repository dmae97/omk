# Native skill optimizer cleanup repair

`3.1.2.patch` is a three-line repair to the public MIT package
[@aeondave/pi-skill-optimizer](https://github.com/AeonDave/pi-skill-optimizer),
version `3.1.2`. Copyright and permission terms are retained in [LICENSE](LICENSE).

Public npm archive:
https://registry.npmjs.org/@aeondave/pi-skill-optimizer/-/pi-skill-optimizer-3.1.2.tgz

Registry integrity:
`sha512-lX3ttyn70xsdFo07BlXLARmXLiwh2e5y7MsefWA6gsVfFEVYD8UW+U9Fgpd0wc1NSBpuRUbPxfXMySEiEcna9Q==`

Cleanup skips live or invalid archives before acquiring a durable write lock.
Deletion still acquires the original lock and rechecks file type and expiry, so a
concurrent lease renewal prevents removal. Session deadlines are unchanged.

The existing OMK-managed install/update hooks apply the repair only to the exact
native `omk` package name/version. Already repaired files are unchanged; unknown
versions, source drift and escaping symlinks fail closed. The patch does not
convert a legacy `pi` manifest or run package lifecycle scripts. Direct npm
replacement outside OMK bypasses these hooks; run the updated OMK installer to
restore the repair. No private settings, agents or session artifacts are included.
