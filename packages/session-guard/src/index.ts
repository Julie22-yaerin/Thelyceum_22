export { hashPassword, verifyPassword, type PasswordHash } from "./hash.js";
export {
  isPasswordSet,
  setupMasterPassword,
  authenticateSession,
  validateActiveSession,
  logoutSession,
  type AuthConfig,
  type SessionState,
} from "./session.js";
export {
  issueTrialLicense,
  consumeTrialUsage,
  getTrialStatus,
  type TrialState,
  type TrialValidationResult,
} from "./trial.js";
