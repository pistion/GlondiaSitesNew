/**
 * AuthController
 * Real identity + session management for the paid MVP.
 * Uses bcrypt password hashing, JWT access tokens, and DB-backed rotating
 * refresh tokens (see services/authService.js).
 */

import {
  getUserById,
  getUserProfile,
  updateUserProfile,
  setOwnIdPhotoPath,
  setOwnAvatarPath,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  changePassword,
  updateUserEmail,
  deleteOwnAccount,
} from '../services/authService.js';
import { streamUserIdPhoto, streamUserAvatar } from '../services/adminReceiptService.js';

const AuthController = {
  register: async (req, res, next) => {
    try {
      const { email, password, name, organizationName } = req.body || {};
      const signupIp = req.securityContext?.ip || req.ip || null;
      const session = await registerUser({ email, password, name, organizationName, signupIp });
      res.created(session);
    } catch (error) {
      next(error);
    }
  },

  login: async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const ip = req.securityContext?.ip || req.ip || null;
      const session = await loginUser({ email, password, ip });
      res.ok(session);
    } catch (error) {
      next(error);
    }
  },

  refreshToken: async (req, res, next) => {
    try {
      const rawToken = req.body?.refreshToken || req.body?.token;
      const session = await refreshSession(rawToken);
      res.ok(session);
    } catch (error) {
      next(error);
    }
  },

  logout: async (req, res, next) => {
    try {
      await logoutUser(req.body?.refreshToken || req.body?.token);
      res.ok({ message: 'Logged out successfully.' });
    } catch (error) {
      next(error);
    }
  },

  me: async (req, res, next) => {
    try {
      const user = await getUserById(req.user?.id);
      if (!user) {
        return res.error('UNAUTHENTICATED', 'Your session no longer matches an account. Please sign in again.', 401);
      }
      res.ok({ user });
    } catch (error) {
      next(error);
    }
  },

  // ── Self-service profile ────────────────────────────────────────────────────
  getProfile: async (req, res, next) => {
    try {
      const profile = await getUserProfile(req.user?.id);
      if (!profile) {
        return res.error('UNAUTHENTICATED', 'Your session no longer matches an account. Please sign in again.', 401);
      }
      res.ok({ profile });
    } catch (error) {
      next(error);
    }
  },

  updateProfile: async (req, res, next) => {
    try {
      const profile = await updateUserProfile(req.user?.id, req.body || {});
      res.ok({ profile });
    } catch (error) {
      next(error);
    }
  },

  uploadIdPhoto: async (req, res, next) => {
    try {
      if (!req.file) return res.error('ID_PHOTO_REQUIRED', 'An ID photo file is required.', 400);
      const profile = await setOwnIdPhotoPath(req.user?.id, req.file.path);
      res.created({ profile });
    } catch (error) {
      next(error);
    }
  },

  viewIdPhoto: async (req, res, next) => {
    try {
      await streamUserIdPhoto({
        userId: req.user?.id,
        res,
        adminUserId: req.user?.id,
        action: 'user.profile.id_photo_viewed',
      });
    } catch (error) {
      next(error);
    }
  },

  uploadAvatar: async (req, res, next) => {
    try {
      if (!req.file) return res.error('AVATAR_REQUIRED', 'A profile photo file is required.', 400);
      const profile = await setOwnAvatarPath(req.user?.id, req.file.path);
      res.created({ profile });
    } catch (error) {
      next(error);
    }
  },

  viewAvatar: async (req, res, next) => {
    try {
      await streamUserAvatar({ userId: req.user?.id, res, viewerUserId: req.user?.id });
    } catch (error) {
      next(error);
    }
  },

  changePassword: async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      await changePassword(req.user?.id, currentPassword, newPassword);
      res.ok({ message: 'Password updated successfully.' });
    } catch (error) {
      next(error);
    }
  },

  updateEmail: async (req, res, next) => {
    try {
      const { newEmail, email, currentPassword } = req.body || {};
      const profile = await updateUserEmail(req.user?.id, newEmail || email, currentPassword);
      res.ok({ profile });
    } catch (error) {
      next(error);
    }
  },

  deleteAccount: async (req, res, next) => {
    try {
      const { currentPassword } = req.body || {};
      await deleteOwnAccount(req.user?.id, currentPassword);
      res.ok({ message: 'Account deleted.' });
    } catch (error) {
      next(error);
    }
  },
};

export default AuthController;
