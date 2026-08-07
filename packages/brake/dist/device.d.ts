/**
 * Device identity.
 *
 * A device id is a stable string that uniquely identifies one machine
 * for license-connection counting. It is generated once on first use and
 * stored in `~/.brake/device-id`. The id is NOT a fingerprint of the
 * machine — it is random — but it is stable across `brake` invocations
 * on the same machine so that re-installing the same host does not count
 * as a new connection.
 */
export declare function deviceIdPath(): string;
export declare function getDeviceId(): Promise<string>;
/** Human-friendly label, mainly for `brake connections` output. */
export declare function deviceLabel(): string;
export declare function getDeviceMeta(): Promise<Record<string, unknown>>;
//# sourceMappingURL=device.d.ts.map