/**
 * ONE-TIME, DESTRUCTIVE reseed of the temple catalogue — not idempotent,
 * not meant to be re-run. Wipes every Category, Sub Category, Item, and
 * Service record, plus all POS transaction history (Order/Booking/
 * Transaction) and the inventory ledgers tied to it (InventoryAdjustment,
 * InventoryReservation — both reference Item/Service by id with no
 * cascading cleanup, so they'd otherwise be left pointing at nothing),
 * then creates 5 realistic records each for Category/SubCategory/Item/
 * Service.
 *
 * Backs up every collection it's about to empty to a timestamped JSON
 * file before deleting anything.
 *
 *   node src/seed/reseedCatalogue.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDatabase = require("../config/database");

const Category = require("../models/categories");
const SubCategory = require("../models/sub-categories");
const Item = require("../models/items");
const Service = require("../models/services");
const GeneralLedger = require("../models/general-ledgers");
const PrintingGroup = require("../models/printing-groups");
const InventoryAdjustment = require("../models/inventory-adjustments");
const InventoryReservation = require("../models/inventory-reservations");
const { Order } = require("../models/orders");
const { Booking } = require("../models/bookings");
const { Transaction } = require("../models/transactions");

const BACKUP_MODELS = [
  ["categories", Category],
  ["subCategories", SubCategory],
  ["items", Item],
  ["services", Service],
  ["orders", Order],
  ["bookings", Booking],
  ["transactions", Transaction],
  ["inventoryAdjustments", InventoryAdjustment],
  ["inventoryReservations", InventoryReservation],
];

async function backup() {
  const dump = {};
  for (const [label, Model] of BACKUP_MODELS) {
    dump[label] = await Model.find({}).lean();
    console.log(`  ${label}: ${dump[label].length} document(s)`);
  }
  const dir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `catalogue-reseed-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`  -> written to ${file}`);
  return file;
}

async function wipe() {
  for (const [label, Model] of BACKUP_MODELS) {
    const result = await Model.deleteMany({});
    console.log(`  ${label}: ${result.deletedCount} document(s) deleted`);
  }
}

async function createCategories() {
  const rows = [
    { name: "Archanai", code: "ARCH", color: "#F59E0B", displayOrder: 1, description: "Deity-specific archana offerings." },
    { name: "Homam", code: "HOMAM", color: "#EA580C", displayOrder: 2, description: "Fire ritual offerings." },
    { name: "Special Poojas", code: "SPECIAL", color: "#B3273F", displayOrder: 3, description: "Personal and occasion-based poojas." },
    { name: "Prasadam", code: "PRASADAM", color: "#16A34A", displayOrder: 4, description: "Blessed food offerings sold at the counter." },
    { name: "Pooja Items", code: "ITEMS", color: "#0EA5E9", displayOrder: 5, description: "Physical items used in worship." },
  ];
  const docs = await Category.create(rows);
  console.log(`  created ${docs.length} categor${docs.length === 1 ? "y" : "ies"}`);
  return Object.fromEntries(docs.map((d) => [d.code, d]));
}

async function createSubCategories() {
  const rows = [
    { name: "Daily", code: "DAILY", color: "#F59E0B", displayOrder: 1, description: "Everyday offerings, no advance notice needed." },
    { name: "Weekly", code: "WEEKLY", color: "#EA580C", displayOrder: 2, description: "Offered on a fixed weekday." },
    { name: "Festival", code: "FESTIVAL", color: "#B3273F", displayOrder: 3, description: "Tied to a specific festival calendar date." },
    { name: "Personal Booking", code: "PERSONAL", color: "#7C3AED", displayOrder: 4, description: "Booked ahead for a specific family/date." },
    { name: "Essentials", code: "ESSENTIALS", color: "#0EA5E9", displayOrder: 5, description: "Everyday pooja items kept in stock." },
  ];
  const docs = await SubCategory.create(rows);
  console.log(`  created ${docs.length} sub-categor${docs.length === 1 ? "y" : "ies"}`);
  return Object.fromEntries(docs.map((d) => [d.code, d]));
}

async function createItems(categories, subCategories, generalLedgerId, printingGroupId) {
  const rows = [
    {
      code: "ITM-GHEE",
      name: "Ghee Lamp Oil",
      tamilName: "நெய் விளக்கு எண்ணெய்",
      generalLedger: generalLedgerId,
      salePrice: 5,
      printingGroup: printingGroupId,
      categoryDetails: [{ category: categories.ITEMS._id, subCategory: subCategories.ESSENTIALS._id, displayOrder: 1 }],
      isInventoryApplicable: true,
      unitOfMeasure: "ML",
      threshold: 20,
      minQuantity: 1,
      maxQuantity: 10,
      currentStock: 200,
    },
    {
      code: "ITM-CAMPHOR",
      name: "Camphor Pack",
      tamilName: "பச்சைக் கற்பூரம்",
      generalLedger: generalLedgerId,
      salePrice: 3,
      printingGroup: printingGroupId,
      categoryDetails: [{ category: categories.ITEMS._id, subCategory: subCategories.ESSENTIALS._id, displayOrder: 2 }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 15,
      minQuantity: 1,
      maxQuantity: 10,
      currentStock: 150,
    },
    {
      code: "ITM-GARLAND",
      name: "Flower Garland",
      tamilName: "பூ மாலை",
      generalLedger: generalLedgerId,
      salePrice: 8,
      printingGroup: printingGroupId,
      categoryDetails: [{ category: categories.ITEMS._id, subCategory: subCategories.DAILY._id, displayOrder: 3 }],
      isInventoryApplicable: true,
      unitOfMeasure: "PCS",
      threshold: 10,
      minQuantity: 1,
      maxQuantity: 5,
      currentStock: 80,
    },
    {
      code: "ITM-COCONUT",
      name: "Coconut",
      tamilName: "தேங்காய்",
      generalLedger: generalLedgerId,
      salePrice: 4,
      printingGroup: printingGroupId,
      categoryDetails: [{ category: categories.ITEMS._id, subCategory: subCategories.ESSENTIALS._id, displayOrder: 4 }],
      isInventoryApplicable: true,
      unitOfMeasure: "PCS",
      threshold: 20,
      minQuantity: 1,
      maxQuantity: 10,
      currentStock: 300,
    },
    {
      code: "ITM-PONGAL",
      name: "Sweet Pongal Prasadam",
      tamilName: "சர்க்கரை பொங்கல்",
      generalLedger: generalLedgerId,
      salePrice: 6,
      printingGroup: printingGroupId,
      categoryDetails: [{ category: categories.PRASADAM._id, subCategory: subCategories.FESTIVAL._id, displayOrder: 1 }],
      isInventoryApplicable: true,
      unitOfMeasure: "BOX",
      threshold: 10,
      minQuantity: 1,
      maxQuantity: 5,
      currentStock: 60,
    },
  ];
  const docs = await Item.create(rows);
  console.log(`  created ${docs.length} item(s)`);
  return docs;
}

async function createServices(categories, subCategories, generalLedgerId) {
  const rows = [
    {
      code: "SVC-GANESHA",
      name: "Ganesha Archana",
      tamilName: "விநாயகர் அர்ச்சனை",
      description: "Daily archana to Lord Ganesha for obstacle removal.",
      generalLedger: generalLedgerId,
      salePrice: 25,
      categoryDetails: [{ category: categories.ARCH._id, subCategory: subCategories.DAILY._id, displayOrder: 1 }],
    },
    {
      code: "SVC-RUDRA",
      name: "Rudrabhishekam",
      tamilName: "ருத்ராபிஷேகம்",
      description: "Sacred bathing ritual for Lord Shiva, booked in advance for a specific family.",
      generalLedger: generalLedgerId,
      salePrice: 150,
      categoryDetails: [{ category: categories.SPECIAL._id, subCategory: subCategories.PERSONAL._id, displayOrder: 1 }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 4,
    },
    {
      code: "SVC-NAVAGRAHA",
      name: "Navagraha Pooja",
      tamilName: "நவக்கிரக பூஜை",
      description: "Fire ritual to the nine planetary deities, offered weekly.",
      generalLedger: generalLedgerId,
      salePrice: 200,
      categoryDetails: [{ category: categories.HOMAM._id, subCategory: subCategories.WEEKLY._id, displayOrder: 1 }],
    },
    {
      code: "SVC-SATHYA",
      name: "Sathyanarayana Pooja",
      tamilName: "சத்யநாராயண பூஜை",
      description: "Festival-day pooja to Lord Vishnu for prosperity and truth.",
      generalLedger: generalLedgerId,
      salePrice: 175,
      categoryDetails: [{ category: categories.SPECIAL._id, subCategory: subCategories.FESTIVAL._id, displayOrder: 2 }],
    },
    {
      code: "SVC-KALYANAM",
      name: "Kalyanam Booking",
      tamilName: "கல்யாணம் முன்பதிவு",
      description: "Full ceremonial wedding booking at the temple, for a specific family and date.",
      generalLedger: generalLedgerId,
      salePrice: 500,
      categoryDetails: [{ category: categories.SPECIAL._id, subCategory: subCategories.PERSONAL._id, displayOrder: 3 }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 6,
    },
  ];
  const docs = await Service.create(rows);
  console.log(`  created ${docs.length} service(s)`);
  return docs;
}

async function run() {
  await connectDatabase();

  console.log("\n>>> 1. Backing up categories/subCategories/items/services/orders/bookings/transactions/inventory*");
  await backup();

  const generalLedger = await GeneralLedger.findOne(GeneralLedger.notDeletedFilter({ status: 1 }));
  if (!generalLedger) throw new Error("No active General Ledger account found — create one first (Admin > Masters > General Ledgers).");
  const printingGroup = await PrintingGroup.findOne(PrintingGroup.notDeletedFilter({ status: 1 }));
  if (!printingGroup) throw new Error("No active Printing Group found — create one first (Admin > Masters > Printing Groups).");
  console.log(`\n>>> Using General Ledger "${generalLedger.name}" and Printing Group "${printingGroup.name}" for the new Items/Services.`);

  console.log("\n>>> 2. Wiping categories/subCategories/items/services/orders/bookings/transactions/inventory*");
  await wipe();

  console.log("\n>>> 3. Creating 5 categories");
  const categories = await createCategories();

  console.log("\n>>> 4. Creating 5 sub-categories");
  const subCategories = await createSubCategories();

  console.log("\n>>> 5. Creating 5 items");
  await createItems(categories, subCategories, generalLedger._id, printingGroup._id);

  console.log("\n>>> 6. Creating 5 services");
  await createServices(categories, subCategories, generalLedger._id);

  console.log("\n>>> Reseed complete.\n");
  process.exit(0);
}

run().catch((err) => {
  console.error(">>> reseedCatalogue failed:", err);
  process.exit(1);
});
