const Category = require("../../models/categories");
const SubCategory = require("../../models/sub-categories");

/** Missing posVisibility is treated as visible so existing masters stay on POS. */
const POS_VISIBLE = { $ne: false };

async function loadPosVisibleHierarchy() {
  const categories = await Category.find(
    Category.notDeletedFilter({ status: 1, posVisibility: POS_VISIBLE })
  )
    .select("name color image")
    .sort({ displayOrder: 1, name: 1 });
  const categoryIds = categories.map((c) => c._id);
  const subCategories = await SubCategory.find(
    SubCategory.notDeletedFilter({
      status: 1,
      posVisibility: POS_VISIBLE,
      category: { $in: categoryIds },
    })
  ).select("name tamilName color image category");
  return { categories, subCategories, categoryIds, subCategoryIds: subCategories.map((s) => s._id) };
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
  posHierarchyClause,
  offeringInPosHierarchy,
};
