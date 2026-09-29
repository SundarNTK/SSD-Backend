const Category = require("../../models/categories");
const SubCategory = require("../../models/sub-categories");

/** Missing posVisibility/adminBookingVisibility is treated as visible so existing masters stay visible. */
const POS_VISIBLE = { $ne: false };

/**
 * Loads the Category/SubCategory hierarchy visible under a given boolean
 * flag — "posVisibility" for the POS Portal counter, "adminBookingVisibility"
 * for the Admin Booking Panel. Both trees are otherwise identical, so this is
 * the one place either visibility gate is defined.
 */
async function loadVisibleHierarchy(field) {
  const categories = await Category.find(
    Category.notDeletedFilter({ status: 1, [field]: POS_VISIBLE })
  )
    .select("name color image")
    .sort({ displayOrder: 1, name: 1 });
  const categoryIds = categories.map((c) => c._id);
  const subCategories = await SubCategory.find(
    SubCategory.notDeletedFilter({
      status: 1,
      [field]: POS_VISIBLE,
      category: { $in: categoryIds },
    })
  ).select("name tamilName color image category displayOrder");
  return { categories, subCategories, categoryIds, subCategoryIds: subCategories.map((s) => s._id) };
}

function loadPosVisibleHierarchy() {
  return loadVisibleHierarchy("posVisibility");
}

function loadAdminBookingVisibleHierarchy() {
  return loadVisibleHierarchy("adminBookingVisibility");
}

/** Picks the right hierarchy loader for the tree a request came in on. */
function loadHierarchyForPortal(posPortal) {
  return posPortal === "admin" ? loadAdminBookingVisibleHierarchy() : loadPosVisibleHierarchy();
}

function posHierarchyClause(categoryIds, subCategoryIds) {
  return {
    $or: [
      { categoryDetails: { $exists: false } },
      { categoryDetails: { $size: 0 } },
      {
        categoryDetails: {
          $elemMatch: {
            category: { $in: categoryIds },
            $or: [{ subCategory: null }, { subCategory: { $exists: false } }, { subCategory: { $in: subCategoryIds } }],
          },
        },
      },
    ],
  };
}

function offeringInPosHierarchy(doc, categoryIds, subCategoryIds) {
  const details = doc.categoryDetails;
  if (!details || details.length === 0) return true;
  const catSet = new Set(categoryIds.map(String));
  const subSet = new Set(subCategoryIds.map(String));
  return details.some((cd) => {
    if (!cd.category || !catSet.has(String(cd.category))) return false;
    if (!cd.subCategory) return true;
    return subSet.has(String(cd.subCategory));
  });
}

module.exports = {
  POS_VISIBLE,
  loadPosVisibleHierarchy,
  loadAdminBookingVisibleHierarchy,
  loadHierarchyForPortal,
  posHierarchyClause,
  offeringInPosHierarchy,
};
