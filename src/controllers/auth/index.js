const express = require("express");
const env = require("../../config/env");
const validateBody = require("../../common/middleware/validate");
const { authLimiter } = require("../../common/middleware/rate-limit");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { hashPassword, comparePassword, assertStrongPassword } = require("../../common/utils/password");
const { signSessionToken } = require("../../common/utils/jwt");
const { generateRawToken, hashToken, addMinutes } = require("../../common/utils/token");
const sendTemplatedEmail = require("../../utilities/helpers/send-templated-email");
const findActiveEntityByCode = require("../../utilities/helpers/find-active-entity-by-code");
const resolveMergedPermissions = require("../../utilities/helpers/resolve-merged-permissions");
const findActiveRoleByName = require("../../utilities/helpers/find-active-role-by-name");
const findActiveUserByEmail = require("../../utilities/helpers/find-active-user-by-email");
const findActiveUserByEmailOrMobile = require("../../utilities/helpers/find-active-user-by-email-or-mobile");
const findUserByActivationToken = require("../../utilities/helpers/find-user-by-activation-token");
const findUserByResetToken = require("../../utilities/helpers/find-user-by-reset-token");
const createPendingUser = require("../../utilities/helpers/create-pending-user");
const createCustomerProfile = require("../../utilities/helpers/create-customer-profile");
const { User } = require("../../models/users");
const { USER_TYPES } = require("../../utilities/constants/user-types");
const {
  loginSchema,
  activateSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  registerSchema,
} = require("./request-objects");

async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await findActiveUserByEmail(email);
    // Same message whether the email doesn't exist or the password is wrong —
    // never reveal which one it was.
    const genericError = "Invalid email or password.";

    if (!user || !user.isAccountUsable()) throw genericError;
    if (!user.passwordHash) {
      throw "This account hasn't set a password yet — please use the activation link sent to your email.";
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) throw genericError;

    user.lastLoginAt = new Date();
    await user.save();

    const defaultAssignment = user.getDefaultEntityAssignment();
    const permissions = await resolveMergedPermissions(defaultAssignment?.roles || []);
    const token = signSessionToken(user, permissions);

    // `permissions` goes back to the client so the Admin Panel can hide nav
    // and buttons the account can't use. It is a rendering hint only — every
    // route re-derives it server-side per request (auth-guard.js), so a
    // tampered copy in localStorage buys nothing but a broken-looking menu.
    return responseHandler({
      res,
      successMessage: "Signed in successfully.",
      response: { token, user: { ...user.toSessionUser(), permissions } },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 401 : 500 });
  }
}

/**
 * Public — anyone can call this, so it only ever creates a CUSTOMER
 * account. Admin/Super Admin accounts are never self-registered; those
 * come from an existing admin using the User Master, which reuses the same
 * createPendingUser() / createCustomerProfile() helpers this calls, just
 * with a different (permission-checked) caller and userType.
 *
 * Creates both records: the User (login identity) and the linked Customer
 * (booking profile — FSD §3.12's fields). If the Customer half fails after
 * the User was already created, the User is rolled back rather than left
 * as a login with no profile behind it.
 */
async function register(req, res) {
  let createdUser = null;
  try {
    const { name, email, mobileNumber, dateOfBirth, gender, familyMembers } = req.body;

    const entity = await findActiveEntityByCode(env.DEFAULT_ENTITY_CODE);
    if (!entity) throw "Registration isn't available right now — no active entity is configured.";

    const customerRole = await findActiveRoleByName("Customer");

    const { user, rawToken } = await createPendingUser({
      name,
      email,
      mobileNumber,
      userType: USER_TYPES.CUSTOMER,
      entityId: entity._id,
      roleIds: customerRole ? [customerRole._id] : [],
    });
    createdUser = user;

    await createCustomerProfile({
      entityId: entity._id,
      linkedUserId: user._id,
      name,
      mobileNumber,
      email,
      dateOfBirth,
      gender,
      familyMembers,
    });

    const activationUrl = `${env.ADMIN_APP_URL}/admin/activate/${rawToken}`;
    await sendTemplatedEmail("ACCOUNT_ACTIVATION", entity._id, user.email, {
      name: user.name,
      activationUrl,
    });

    return responseHandler({
      res,
      successMessage: "Registration received — check your email to set your password and finish signing in.",
      statusCode: 201,
    });
  } catch (error) {
    if (createdUser) {
      await User.deleteOne({ _id: createdUser._id }).catch(() => {});
    }
    return exceptionHandler({ res, error });
  }
}

const TOKEN_INFO_ERRORS = {
  invalid: "This link is invalid or has already been used.",
  expired: "This link has expired. Please request a new one.",
};

/**
 * Read-only — lets the Set-Password page greet the person by name and,
 * more importantly, feed their real name/email/mobile into the client-side
 * password-strength check *before* they submit. Without this, the client
 * has no way to know what the server will reject, so a password like
 * "Sundar@SSD123" can show "Excellent" on screen and still bounce at
 * submit time — confusing, and avoidable.
 */
async function activationTokenInfo(req, res) {
  try {
    const { user, reason } = await findUserByActivationToken(req.params.token);
    if (!user) throw TOKEN_INFO_ERRORS[reason];
    if (user.passwordSetAt) throw "Password already created. Please log in instead.";

    return responseHandler({
      res,
      response: { name: user.name, email: user.email, mobileNumber: user.mobileNumber },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: 404 });
  }
}

async function resetTokenInfo(req, res) {
  try {
    const { user, reason } = await findUserByResetToken(req.params.token);
    if (!user) throw TOKEN_INFO_ERRORS[reason];

    return responseHandler({
      res,
      response: { name: user.name, email: user.email, mobileNumber: user.mobileNumber },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: 404 });
  }
}

async function activate(req, res) {
  try {
    const { token, newPassword } = req.body;
    const { user, reason } = await findUserByActivationToken(token);

    if (!user) throw TOKEN_INFO_ERRORS[reason];
    if (user.passwordSetAt) throw "Password already created. Please log in instead.";

    assertStrongPassword(newPassword, [user.name, user.email, user.mobileNumber]);

    user.passwordHash = await hashPassword(newPassword);
    user.passwordSetAt = new Date();
    user.activationTokenHash = null;
    user.activationTokenExpiresAt = null;
    await user.save();

    return responseHandler({ res, successMessage: "Password created successfully. You can now sign in." });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

async function forgotPassword(req, res) {
  try {
    const { identifier } = req.body;
    const user = await findActiveUserByEmailOrMobile(identifier);

    // Deliberately generic and always-success — unlike a literal port of
    // HEB's controller (which throws "User not found"), this never confirms
    // or denies whether an account exists for a given email/mobile.
    if (user && user.isAccountUsable()) {
      const rawToken = generateRawToken();
      user.passwordResetTokenHash = hashToken(rawToken);
      user.passwordResetTokenExpiresAt = addMinutes(new Date(), env.RESET_TOKEN_TTL_MINUTES);
      await user.save();

      const resetUrl = `${env.ADMIN_APP_URL}/admin/reset-password/${rawToken}`;
      const defaultAssignment = user.getDefaultEntityAssignment();
      await sendTemplatedEmail("PASSWORD_RESET", defaultAssignment?.entity, user.email, {
        name: user.name,
        resetUrl,
        expiresInMinutes: env.RESET_TOKEN_TTL_MINUTES,
      });
    }

    return responseHandler({
      res,
      successMessage: "If that account exists, a reset link has been sent to the registered email.",
    });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    const { user, reason } = await findUserByResetToken(token);

    if (!user) throw TOKEN_INFO_ERRORS[reason];

    assertStrongPassword(newPassword, [user.name, user.email, user.mobileNumber]);

    user.passwordHash = await hashPassword(newPassword);
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiresAt = null;
    await user.save();

    return responseHandler({ res, successMessage: "Password reset successfully. You can now sign in." });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

// Mounted at /auth — see routes/index.js for why the prefix lives there.
const router = express.Router();

// authLimiter on every route below: these are the only ones in the whole
// service reachable without a valid session token, which makes them the
// only ones where repeated guessing (login) or spam (register,
// forgot-password) is even possible. See common/middleware/rate-limit.js.
router.post("/login", authLimiter, validateBody(loginSchema), login);
router.post("/register", authLimiter, validateBody(registerSchema), register);

// Read-only — let Set-Password/Reset-Password greet the person by name and
// check password strength against their real name/email/mobile *before*
// they submit, instead of only finding out at the end.
router.get("/activation/:token", authLimiter, activationTokenInfo);
router.get("/reset-password/:token", authLimiter, resetTokenInfo);

router.post("/activate", authLimiter, validateBody(activateSchema), activate);
router.post("/forgot-password", authLimiter, validateBody(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), resetPassword);

module.exports = router;
