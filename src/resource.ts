import type { ResourceIdentity } from "./types.js";

export function sameResourceIdentity(
  left: ResourceIdentity,
  right: ResourceIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    left.account === right.account &&
    left.kind === right.kind &&
    left.key === right.key
  );
}
