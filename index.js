/**
 * dsh-adaptive-shell, node half.
 *
 * This package contributes browser presentation only: it measures the viewport,
 * stamps form-factor attributes on `<html>`, and ships one stylesheet plus three
 * small slot occupants (composer-free navigation button, drawer scrim, settings
 * rows). The empty `apply` gives the Loader a host-side row so the package
 * composes like any other plugin, while the browser half ships through
 * `exports["./client"]` and is wired by the `dsh.client` declaration.
 *
 * @module dsh-adaptive-shell
 */

/** Host plugin body — no host-side contribution. */
export function apply() {}
