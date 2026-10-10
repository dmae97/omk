# Bash sandbox setup

OMK runs every local bash command inside an operating-system sandbox and refuses to run it when no
sandbox can start (`OMK_BASH_SANDBOX` defaults to `enforce`). This page gets the sandbox working on
each platform. `omk doctor` shows the current state in one line, with the fix for this machine.

```bash
omk doctor
#   ✓ bash sandbox   linux backend ready (enforce, 10 ms probe)
```

OMK proves the sandbox works before the first command: on Linux it starts `bwrap` once with the same
namespace flags it uses for real commands. A binary on `PATH` that cannot create namespaces is
reported as unavailable instead of failing later on your first `!ls`.

## Linux

Install bubblewrap from your distribution:

| Distribution | Command |
| --- | --- |
| Debian, Ubuntu | `sudo apt install bubblewrap` |
| Fedora, RHEL | `sudo dnf install bubblewrap` |
| Arch | `sudo pacman -S bubblewrap` |
| openSUSE | `sudo zypper install bubblewrap` |
| Alpine | `sudo apk add bubblewrap` |

Restart OMK afterwards; the sandbox is detected once per session.

### Ubuntu 23.10 and later: AppArmor user-namespace restriction

Ubuntu sets `kernel.apparmor_restrict_unprivileged_userns=1`. An unprivileged program may still
create a user namespace, but AppArmor's default `unprivileged_userns` profile denies it any
capabilities inside. Ubuntu 24.04 ships no AppArmor profile for `bwrap` (a `bwrap-userns-restrict`
profile first ships in 25.10). When the restriction is on and OMK's probe start of `bwrap` fails,
`omk doctor` reports `AppArmor blocks unprivileged user namespaces for bwrap`; when the probe passes,
nothing needs to change.

Ubuntu's documented remedy is a per-program profile that grants `userns`:

```bash
sudo tee /etc/apparmor.d/bwrap > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,

  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap
```

Trade-off: any program that runs `bwrap` can then create user namespaces with capabilities. Prefer
this over disabling the restriction system-wide (`sysctl kernel.apparmor_restrict_unprivileged_userns=0`),
which removes the protection for every program.

### Containers and hardened kernels

Docker's default seccomp profile blocks the namespace calls bubblewrap makes, and some kernels set
`user.max_user_namespaces=0`. `omk doctor` names which one applies. Run OMK on the host, give the
container a seccomp profile that permits `unshare`, or raise `user.max_user_namespaces`.

## macOS

`sandbox-exec` is part of macOS; nothing to install.

## Windows

Native Windows has no supported sandbox backend, so bash is blocked under the default `enforce`
mode. Run OMK inside WSL2, where the Linux instructions above apply.

## Running without isolation

`OMK_BASH_SANDBOX=audit` runs commands unwrapped and still records every spawn decision in the
session's replay ledger. `OMK_BASH_SANDBOX=off` disables the sandbox policy entirely. Both are
explicit choices: OMK never falls back to them on its own.
