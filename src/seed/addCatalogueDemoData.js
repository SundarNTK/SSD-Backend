/**
 * ADDITIVE, non-destructive catalogue top-up — creates a batch of real-named
 * Items and Services (pooja items, archanai, homams, abhishekams, life-event
 * bookings, ...) under the temple's EXISTING Categories/SubCategories,
 * referencing existing General Ledger and Printing Group masters. Nothing
 * is deleted, updated, or wiped — this only inserts new documents, so it's
 * safe to run against the live catalogue (unlike reseedCatalogue.js, which
 * is destructive).
 *
 * Not idempotent: the `code` on every row below is new, so a second run
 * will fail on the unique-code index (E11000) rather than silently
 * duplicating anything — that's the intended guard, not a bug to work
 * around. If more rows are needed later, give them fresh codes and append
 * to the lists below rather than re-running this file as-is.
 *
 *   node src/seed/addCatalogueDemoData.js
 */
require("dotenv").config();
const connectDatabase = require("../config/database");

const Category = require("../models/categories");
const SubCategory = require("../models/sub-categories");
const GeneralLedger = require("../models/general-ledgers");
const PrintingGroup = require("../models/printing-groups");
const Item = require("../models/items");
const Service = require("../models/services");

/** Looks a master up by its `code` field and throws a clear error naming
 *  which one is missing rather than letting a later `.create()` fail on a
 *  cryptic "category is required" validation error. */
function indexByCode(docs, label) {
  const byCode = new Map(docs.map((d) => [d.code, d]));
  return (code) => {
    const doc = byCode.get(code);
    if (!doc) throw new Error(`${label} with code "${code}" not found — check it still exists.`);
    return doc._id;
  };
}

/** Same idea, but by `name` — General Ledger and Printing Group don't carry
 *  the short `code`-per-row convention Category/SubCategory do. */
function indexByName(docs, label) {
  const byName = new Map(docs.map((d) => [d.name, d]));
  return (name) => {
    const doc = byName.get(name);
    if (!doc) throw new Error(`${label} named "${name}" not found — check it still exists.`);
    return doc._id;
  };
}

async function run() {
  await connectDatabase();

  const [categories, subCategories, generalLedgers, printingGroups] = await Promise.all([
    Category.find(Category.notDeletedFilter({ status: 1 })).select("name code").lean(),
    SubCategory.find(SubCategory.notDeletedFilter({ status: 1 })).select("name code").lean(),
    GeneralLedger.find(GeneralLedger.notDeletedFilter({ status: 1 })).select("name code").lean(),
    PrintingGroup.find(PrintingGroup.notDeletedFilter({ status: 1 })).select("name").lean(),
  ]);

  const cat = indexByCode(categories, "Category");
  const sub = indexByCode(subCategories, "SubCategory");
  const gl = indexByName(generalLedgers, "General Ledger");
  const pg = indexByName(printingGroups, "Printing Group");

  // ── Items — physical pooja items sold at the counter ─────────────────────
  const items = [
    {
      code: "ITM-VASTRA",
      name: "Vastra",
      tamilName: "வஸ்திரம்",
      salePrice: 15,
      generalLedger: gl("Vastra Sales Account"),
      printingGroup: pg("Vastra Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("ESSENTIALS") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PCS",
      threshold: 10,
      currentStock: 60,
    },
    {
      code: "ITM-PANNEER",
      name: "Rose Water",
      tamilName: "பன்னீர்",
      salePrice: 2,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("ESSENTIALS") }],
      isInventoryApplicable: true,
      unitOfMeasure: "BOTTLE",
      threshold: 15,
      currentStock: 100,
    },
    {
      code: "ITM-VIBUTHI",
      name: "Sacred Ash",
      tamilName: "விபூதி",
      salePrice: 1,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("ESSENTIALS") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 20,
      currentStock: 150,
    },
    {
      code: "ITM-SANDAL",
      name: "Sandalwood Paste",
      tamilName: "சந்தனம்",
      salePrice: 3,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("ESSENTIALS") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 15,
      currentStock: 90,
    },
    {
      code: "ITM-WICK",
      name: "Lamp Wick",
      tamilName: "திரி",
      salePrice: 1.5,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Deepam Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("SUB-CAT-01") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 20,
      currentStock: 120,
    },
    {
      code: "ITM-BETEL",
      name: "Betel Leaves & Nuts",
      tamilName: "வெற்றிலை பாக்கு",
      salePrice: 2,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("SUB-CAT-01") }],
      isInventoryApplicable: true,
      unitOfMeasure: "SET",
      threshold: 15,
      currentStock: 80,
    },
    {
      code: "ITM-TURMERIC",
      name: "Turmeric Powder",
      tamilName: "மஞ்சள் தூள்",
      salePrice: 2,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("SUB-CAT-01") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 15,
      currentStock: 90,
    },
    {
      code: "ITM-SESAMEOIL",
      name: "Sesame Oil for Lamps",
      tamilName: "எண்ணெய் (விளக்கு)",
      salePrice: 4,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Deepam Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("DAILY") }],
      isInventoryApplicable: true,
      unitOfMeasure: "BOTTLE",
      threshold: 10,
      currentStock: 70,
    },
    {
      code: "ITM-RICE",
      name: "Pooja Rice",
      tamilName: "அரிசி",
      salePrice: 3,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("K") }],
      isInventoryApplicable: true,
      unitOfMeasure: "KG",
      threshold: 10,
      currentStock: 50,
    },
    {
      code: "ITM-BANANA",
      name: "Banana Bunch",
      tamilName: "வாழைப்பழம்",
      salePrice: 2.5,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("K") }],
      isInventoryApplicable: true,
      unitOfMeasure: "BUNCH",
      threshold: 10,
      currentStock: 40,
    },
    {
      code: "ITM-KALKANDU",
      name: "Sugar Candy",
      tamilName: "கற்கண்டு",
      salePrice: 2,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("K") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 15,
      currentStock: 70,
    },
    {
      code: "ITM-MILK",
      name: "Cow's Milk",
      tamilName: "பால்",
      salePrice: 3.5,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Abhishekam Tickets"),
      categoryDetails: [{ category: cat("K") }],
      isInventoryApplicable: true,
      unitOfMeasure: "L",
      threshold: 10,
      currentStock: 30,
    },
    {
      code: "ITM-HONEY",
      name: "Honey",
      tamilName: "தேன்",
      salePrice: 6,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Abhishekam Tickets"),
      categoryDetails: [{ category: cat("K") }],
      isInventoryApplicable: true,
      unitOfMeasure: "BOTTLE",
      threshold: 8,
      currentStock: 25,
    },
    {
      code: "ITM-FLOWERBASKET",
      name: "Flower Basket",
      tamilName: "பூக் கூடை",
      salePrice: 10,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("DAILY") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PCS",
      threshold: 10,
      currentStock: 40,
    },
    {
      code: "ITM-AGARBATTI",
      name: "Incense Sticks",
      tamilName: "ஊதுபத்தி",
      salePrice: 2.5,
      generalLedger: gl("POS Sales"),
      printingGroup: pg("Pooja Tickets"),
      categoryDetails: [{ category: cat("ITEMS"), subCategory: sub("ESSENTIALS") }],
      isInventoryApplicable: true,
      unitOfMeasure: "PACK",
      threshold: 20,
      currentStock: 110,
    },
  ];

  // ── Services — archanai, homams, abhishekams, life-event bookings ────────
  const services = [
    {
      code: "SVC-SAHASRANAMA",
      name: "Sahasranama Archanai",
      tamilName: "சஹஸ்ரநாம அர்ச்சனை",
      description: "Archana reciting the deity's 1000 sacred names.",
      salePrice: 30,
      generalLedger: gl("Archana Receipts Account"),
      printingGroup: pg("Sahasranamam Tickets"),
      categoryDetails: [{ category: cat("ARCH"), subCategory: sub("WEEKLY") }],
    },
    {
      code: "SVC-ABHISHEKAM",
      name: "Abhishekam",
      tamilName: "அபிஷேகம்",
      description: "Sacred bathing ritual performed for the main deity.",
      salePrice: 50,
      generalLedger: gl("Abhishekam Receipts Account"),
      printingGroup: pg("Abhishekam Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("DAILY") }],
    },
    {
      code: "SVC-PANCHAMRUTHA",
      name: "Panchamrutha Abhishekam",
      tamilName: "பஞ்சாமிர்த அபிஷேகம்",
      description: "Abhishekam with the five sacred nectars — milk, curd, ghee, honey, and sugar.",
      salePrice: 80,
      generalLedger: gl("Panchamrutha Account"),
      printingGroup: pg("Panchamrutha Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("WEEKLY") }],
    },
    {
      code: "SVC-KUMKUMARCHANAI",
      name: "Kumkumarchanai",
      tamilName: "குங்குமார்ச்சனை",
      description: "Kumkum archana offered to the Goddess.",
      salePrice: 15,
      generalLedger: gl("Kumkumarchana Account"),
      printingGroup: pg("Archana Tickets"),
      categoryDetails: [{ category: cat("ARCH"), subCategory: sub("DAILY") }],
    },
    {
      code: "SVC-NAVAGRAHAHOMAM",
      name: "Navagraha Shanti Homam",
      tamilName: "நவக்கிரக சாந்தி ஹோமம்",
      description: "Fire ritual to pacify the nine planetary deities.",
      salePrice: 250,
      generalLedger: gl("Navagraha Receipts Account"),
      printingGroup: pg("Navagraha Tickets"),
      categoryDetails: [{ category: cat("HOMAM"), subCategory: sub("WEEKLY") }],
    },
    {
      code: "SVC-GANAPATHYHOMAM",
      name: "Maha Ganapathy Homam",
      tamilName: "மகா கணபதி ஹோமம்",
      description: "Fire ritual to Lord Ganapathy for removing obstacles.",
      salePrice: 150,
      generalLedger: gl("Homam Receipts Account"),
      printingGroup: pg("Homam Tickets"),
      categoryDetails: [{ category: cat("HOMAM") }],
    },
    {
      code: "SVC-MRITYUNJAYA",
      name: "Mrityunjaya Homam",
      tamilName: "மிருத்யுஞ்ஜய ஹோமம்",
      description: "Fire ritual to Lord Shiva for health and protection, booked for a specific person.",
      salePrice: 300,
      generalLedger: gl("Homam Receipts Account"),
      printingGroup: pg("Homam Tickets"),
      categoryDetails: [{ category: cat("HOMAM"), subCategory: sub("PERSONAL") }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 1,
    },
    {
      code: "SVC-SUDARSHANA",
      name: "Sudarshana Homam",
      tamilName: "சுதர்சன ஹோமம்",
      description: "Fire ritual to Lord Vishnu's Sudarshana Chakra for protection from harm.",
      salePrice: 180,
      generalLedger: gl("Homam Receipts Account"),
      printingGroup: pg("Homam Tickets"),
      categoryDetails: [{ category: cat("HOMAM") }],
    },
    {
      code: "SVC-VAZHIPADU",
      name: "Vazhipadu",
      tamilName: "வழிபாடு",
      description: "General temple offering on the devotee's behalf.",
      salePrice: 10,
      generalLedger: gl("General Donation Account"),
      printingGroup: pg("Vazhipadu Tickets"),
      categoryDetails: [{ category: cat("K") }],
    },
    {
      code: "SVC-ANNADHANAM",
      name: "Annadhanam Sponsorship",
      tamilName: "அன்னதானம் நிதியுதவி",
      description: "Sponsors a day's free meal offering to devotees.",
      salePrice: 100,
      generalLedger: gl("Annadhanam Account"),
      printingGroup: pg("Annadhanam Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("PERSONAL") }],
    },
    {
      code: "SVC-VIPDARSHAN",
      name: "VIP Darshan",
      tamilName: "விஐபி தரிசனம்",
      description: "Priority darshan without the general queue.",
      salePrice: 50,
      generalLedger: gl("VIP Darshan Account"),
      printingGroup: pg("VIP Darshan Tickets"),
      categoryDetails: [{ category: cat("SPECIAL") }],
    },
    {
      code: "SVC-UTSAVAM",
      name: "Utsavam Sponsorship",
      tamilName: "உற்சவம் நிதியுதவி",
      description: "Sponsors a day of the temple's annual festival procession.",
      salePrice: 1000,
      generalLedger: gl("Utsavam Account"),
      printingGroup: pg("Utsavam Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("FESTIVAL") }],
    },
    {
      code: "SVC-DEEPASEVA",
      name: "Deepa Seva",
      tamilName: "தீப சேவை",
      description: "Lighting of lamps in the devotee's name.",
      salePrice: 20,
      generalLedger: gl("Archanai Income"),
      printingGroup: pg("Deepam Tickets"),
      categoryDetails: [{ category: cat("K"), subCategory: sub("DAILY") }],
    },
    {
      code: "SVC-NITHYAPOOJA",
      name: "Nithya Pooja Sponsorship",
      tamilName: "நித்திய பூஜை நிதியுதவி",
      description: "Sponsors a full day of the temple's daily poojas.",
      salePrice: 500,
      generalLedger: gl("Archanai Income"),
      printingGroup: pg("Nithya Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("DAILY") }],
    },
    {
      code: "SVC-SASHTIAPTHAPOORTHI",
      name: "Sashtiaptha Poorthi",
      tamilName: "சஷ்டியப்த பூர்த்தி",
      description: "60th-birthday ceremony booking for a specific family and date.",
      salePrice: 800,
      generalLedger: gl("Special Pooja Account"),
      printingGroup: pg("Special Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("PERSONAL") }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 10,
    },
    {
      code: "SVC-SATHABHISHEKAM",
      name: "Sathabhishekam",
      tamilName: "சதாபிஷேகம்",
      description: "80th-birthday ceremony booking for a specific family and date.",
      salePrice: 1000,
      generalLedger: gl("Special Pooja Account"),
      printingGroup: pg("Special Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("PERSONAL") }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 10,
    },
    {
      code: "SVC-SARPADOSHA",
      name: "Sarpa Dosha Nivarana Pooja",
      tamilName: "சர்ப்ப தோஷ நிவாரண பூஜை",
      description: "Pooja to relieve Sarpa Dosham afflictions in the horoscope.",
      salePrice: 250,
      generalLedger: gl("Special Pooja Account"),
      printingGroup: pg("Special Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL") }],
    },
    {
      code: "SVC-NAMAKARANAM",
      name: "Namakaranam",
      tamilName: "நாமகரணம்",
      description: "Naming ceremony booking for a specific family and date.",
      salePrice: 150,
      generalLedger: gl("Special Pooja Account"),
      printingGroup: pg("Special Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("PERSONAL") }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 5,
    },
    {
      code: "SVC-UPANAYANAM",
      name: "Upanayanam",
      tamilName: "உபநயனம்",
      description: "Sacred thread ceremony booking for a specific family and date.",
      salePrice: 500,
      generalLedger: gl("Special Pooja Account"),
      printingGroup: pg("Special Pooja Tickets"),
      categoryDetails: [{ category: cat("SPECIAL"), subCategory: sub("PERSONAL") }],
      isFamilyMembersRequired: true,
      maxFamilyMembers: 5,
    },
  ];

  console.log(`>>> Creating ${items.length} item(s)...`);
  const createdItems = await Item.create(items);
  console.log(`  created ${createdItems.length} item(s)`);

  console.log(`>>> Creating ${services.length} service(s)...`);
  const createdServices = await Service.create(services);
  console.log(`  created ${createdServices.length} service(s)`);

  console.log("\n>>> Done.\n");
  process.exit(0);
}

run().catch((err) => {
  console.error(">>> addCatalogueDemoData failed:", err);
  process.exit(1);
});
