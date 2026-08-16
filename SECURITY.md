# Security policy

## Supported versions

The latest release on the `main` branch is the supported version. Dark Kitchen AI is a local CLI and interacts with credentials and repositories owned by the person running it.

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Use GitHub's private vulnerability reporting for this repository when available, or contact the maintainer privately through the [GitHub profile](https://github.com/matpeltier).

Include:

- the affected version or commit;
- the command and environment in which it occurs;
- a minimal reproduction that does not contain secrets;
- the impact you observed.

Please redact API keys, GitHub tokens, private repository contents, issue bodies, and runtime logs before sending anything.

## Credentials and generated runtime data

Provider credentials must be supplied through environment variables. `.factory/runtime/` is ignored by Git, but it can still contain issue content, worker results, and local paths; treat it as sensitive on shared machines.
