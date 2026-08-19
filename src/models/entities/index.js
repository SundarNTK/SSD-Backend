const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The top layer everything else in the platform is scoped under — mirrors
 * HEB's Configuration-Service `entities` model (D:\PROJECTS\HEB\Configuration-Service\source\models\entities).
 * SSD runs a single entity today ("SST" — Sri Siva Durga Temple), but every
 * user and, eventually, every master is created *under* an entity rather
 * than assuming there's only ever one — so adding a second temple/branch
 * later is a new Entity document, not a schema change.
 */
const entitySchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, default: uuidv4 },

  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  templeName: { type: String, required: true, trim: true },
  templeTamilName: { type: String, default: "" },

  address: {
    block: { type: String, default: "" },
    unit: { type: String, default: "" },
    street: { type: String, default: "" },
    country: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },

  email: { type: String, default: "" },
  mobileNumber: { type: String, default: "" },
  gstNumber: { type: String, default: "" },

  // Subdomains this entity is reachable on (admin.temple.com, pos.temple.com, ...) —
  // reserved for when a second entity makes host-based resolution (HEB's pattern,
  // D:\PROJECTS\HEB\User-Service\source\utilities\helpers\admin-sign-in-entity-access)
  // actually necessary. Not used for routing yet with only one entity.
  domain: { type: [String], default: [] },

  logoUrl: { type: String, default: "" },
  description: { type: String, default: "" },
});

entitySchema.plugin(auditablePlugin);

entitySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
entitySchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));

module.exports = mongoose.model("Entity", entitySchema);
