import { isSystemAdminRole, isSystemExternalRole } from "../shared/system-roles";

type ProductControlActor = {
  id: number;
  role: string;
};

type ControlledProduct = {
  createdBy: number;
  productManagerUserId?: number | null;
};

/**
 * Publishing a technical baseline changes the controlled definition of a
 * product. Project permissions alone are therefore insufficient: the target
 * product manager (or an administrator) must own the decision.
 *
 * Old test/seed products may not have productManagerUserId populated. For
 * those records the product creator is the compatibility owner.
 */
export function canApproveProductTechnicalChange(
  actor: ProductControlActor,
  product: ControlledProduct,
): boolean {
  if (isSystemExternalRole(actor.role)) return false;
  if (isSystemAdminRole(actor.role)) return true;
  const ownerId = product.productManagerUserId ?? product.createdBy;
  return ownerId === actor.id;
}
