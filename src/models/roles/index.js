const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const permissionSchema = new mongoose.Schema(
  {
    module: { type: String, required: true },
    view: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    fullAccess: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Roles whose behaviour comes from the account's `userType`, not from this
 * `permissions` array — so there is nothing here worth configuring:
 *
 *   System Admin — bypasses every permission check outright.
 *   Customer     — refused at the Admin Panel door by `adminOnly`, before any
 *                  module check runs.
 *
 * Ticking boxes on either one changes nothing, which is worse than offering
 * no control at all: it reads as "access control is broken". They are also
 * what the bootstrap scripts assign by name, so deleting one would break
 * account creation. Locked against edit, delete, and permission changes for
 * everyone, System Admins included.
 *
 * "Admin" is deliberately NOT here — it is the configurable staff role.
 */
const LOCKED_ROLE_NAMES = ["System Admin", "Customer"];

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  permissions: { type: [permissionSchema], default: [] },
});

roleSchema.plugin(auditablePlugin);

/**
 * Exposed on every role the API returns so the Admin Panel can hide the
 * controls it would refuse anyway, without keeping its own copy of the name
 * list to drift out of sync with this one.
 */
roleSchema.virtual("isLocked").get(function isLocked() {
  return LOCKED_ROLE_NAMES.includes(this.name);
});

roleSchema.set("toJSON", { virtuals: true });
roleSchema.set("toObject", { virtuals: true });

roleSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
roleSchema.index({ status: 1, createdAt: -1 });

const Role = mongoose.model("Role", roleSchema);

module.exports = Role;
module.exports.LOCKED_ROLE_NAMES = LOCKED_ROLE_NAMES;
module.exports.isLockedRoleName = (name) => LOCKED_ROLE_NAMES.includes(name);
