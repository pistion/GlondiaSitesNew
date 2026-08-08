import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { hashPassword, verifyPassword } from "./authService.js";

const SESSION_HOURS = Number(process.env.CLOUD_DRIVE_SESSION_HOURS || 8);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tokenHash = (value) => createHash("sha256").update(String(value)).digest("hex");
const secretKey = () =>
  createHash("sha256")
    .update(String(process.env.CLOUD_DRIVE_CREDENTIAL_KEY || process.env.JWT_SECRET || "glondia-local-drive-key"))
    .digest();
const encrypt = (value) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
};
const decrypt = (value) => {
  const body = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), body.subarray(0, 12));
  decipher.setAuthTag(body.subarray(12, 28));
  return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString("utf8");
};
const generatePassword = () =>
  `${randomBytes(9).toString("base64url")}!${randomBytes(5).toString("hex")}`;

async function ownedDrive(user, serviceId) {
  const organizationId = user?.organizationId || (user?.id === "local-user" ? "local-org" : user?.id);
  const service = await prisma.cloudStorageService.findFirst({
    where: { id: serviceId, organizationId, serviceKind: "private_vault", deletedAt: null },
  });
  if (!service) throw fail("Drive service not found.", 404);
  return service;
}

export async function createInitialDriveCredential(serviceId, user) {
  const password = generatePassword();
  const email =
    user?.email ||
    (user?.id && user.id !== "local-user"
      ? (await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } }))?.email
      : null) ||
    "sandbox@glondia.local";
  await prisma.cloudDriveCredential.upsert({
    where: { serviceId },
    create: {
      serviceId,
      userId: user?.id === "local-user" ? null : user?.id,
      accountEmail: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      initialPasswordCiphertext: encrypt(password),
    },
    update: {},
  });
}

export async function getDriveSecurity(user, serviceId) {
  await ownedDrive(user, serviceId);
  let credential = await prisma.cloudDriveCredential.findUnique({ where: { serviceId } });
  if (!credential) {
    await createInitialDriveCredential(serviceId, user);
    credential = await prisma.cloudDriveCredential.findUnique({ where: { serviceId } });
  }
  return {
    accountEmail: credential.accountEmail,
    passwordVersion: credential.passwordVersion,
    initialPasswordAvailable: Boolean(credential.initialPasswordCiphertext),
    initialPasswordViewedAt: credential.initialPasswordViewedAt,
    twoFactorEnabled: credential.twoFactorEnabled,
    twoFactorMethod: credential.twoFactorMethod,
    twoFactorAvailable: false,
  };
}

export async function revealInitialPassword(user, serviceId) {
  await ownedDrive(user, serviceId);
  const credential = await prisma.cloudDriveCredential.findUnique({ where: { serviceId } });
  if (!credential?.initialPasswordCiphertext) throw fail("The initial password has already been collected.", 409);
  const password = decrypt(credential.initialPasswordCiphertext);
  await prisma.cloudDriveCredential.update({
    where: { serviceId },
    data: { initialPasswordCiphertext: null, initialPasswordViewedAt: new Date() },
  });
  return { password };
}

export async function changeDrivePassword(user, serviceId, input = {}) {
  await ownedDrive(user, serviceId);
  const password = String(input.password || "");
  if (password.length < 12) throw fail("Drive password must contain at least 12 characters.");
  await prisma.$transaction([
    prisma.cloudDriveCredential.update({
      where: { serviceId },
      data: {
        passwordHash: await hashPassword(password),
        initialPasswordCiphertext: null,
        passwordVersion: { increment: 1 },
      },
    }),
    prisma.cloudDriveSession.updateMany({
      where: { serviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return getDriveSecurity(user, serviceId);
}

export async function loginToDrive(user, serviceId, input = {}) {
  await ownedDrive(user, serviceId);
  let credential = await prisma.cloudDriveCredential.findUnique({ where: { serviceId } });
  if (!credential) {
    await createInitialDriveCredential(serviceId, user);
    credential = await prisma.cloudDriveCredential.findUnique({ where: { serviceId } });
  }
  const email = String(input.email || "").trim().toLowerCase();
  if (!credential || email !== credential.accountEmail || !(await verifyPassword(input.password, credential.passwordHash))) {
    throw fail("The drive email or password is incorrect.", 401);
  }
  const rawToken = randomBytes(40).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.cloudDriveSession.create({
      data: { serviceId, userId: user?.id === "local-user" ? null : user?.id, tokenHash: tokenHash(rawToken), expiresAt },
    }),
    prisma.cloudDriveCredential.update({ where: { serviceId }, data: { lastLoginAt: new Date() } }),
  ]);
  return { token: rawToken, expiresAt, accountEmail: credential.accountEmail };
}

export async function verifyDriveSession(user, serviceId, rawToken) {
  await ownedDrive(user, serviceId);
  if (!rawToken) throw fail("Sign in to My Drive to continue.", 401);
  const session = await prisma.cloudDriveSession.findUnique({ where: { tokenHash: tokenHash(rawToken) } });
  if (!session || session.serviceId !== serviceId || session.revokedAt || session.expiresAt <= new Date()) {
    throw fail("Your My Drive session has expired. Sign in again.", 401);
  }
  await prisma.cloudDriveSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  return { authenticated: true, expiresAt: session.expiresAt };
}

export const requireDriveSession = async (req, res, next) => {
  try {
    req.driveSession = await verifyDriveSession(req.user, req.params.id, req.headers["x-drive-session"]);
    next();
  } catch (error) {
    next(error);
  }
};
