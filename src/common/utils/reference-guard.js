/**
 * Blocks deleting a master record while it's still mapped in another,
 * currently-active record — e.g. a Category can't be deleted while a
 * (non-deleted) Sub Category still points at it. Deletion here means the
 * usual soft delete (isDeleted: true); a referencing record that is ITSELF
 * already soft-deleted no longer counts, since notDeletedFilter() excludes
 * it — only a still-live mapping blocks the delete.
 *
 * `field` may be a dot-path ("categoryDetails.category") to reach into an
 * array of subdocuments — Mongo matches an array field (or an array of
 * subdocuments via dot-path) against a scalar query value by "does any
 * element equal this" automatically, so the same findOne() shape works for
 * both a plain ObjectId field and an array one.
 */
async function findBlockingReference(referencedBy, id) {
  for (const { model, field, label } of referencedBy ?? []) {
    const found = await model.findOne(model.notDeletedFilter({ [field]: id })).select("_id");
    if (found) {
      return `This record is still mapped to a ${label} and cannot be deleted. Remove or reassign that mapping first.`;
    }
  }
  return null;
}

module.exports = { findBlockingReference };
