import { invokeDb, isTauri } from "../db/runtime";

export type LocalAuthStatus = {
  userId: string;
  hasPassword: boolean;
};

export async function localAuthStatus(userId: string): Promise<LocalAuthStatus> {
  if (!isTauri()) {
    return { userId, hasPassword: false };
  }
  return invokeDb("local_auth_status", { userId });
}

export async function localAuthSetPassword(
  userId: string,
  password: string,
  currentPassword?: string,
): Promise<LocalAuthStatus> {
  return invokeDb("local_auth_set_password", {
    userId,
    password,
    currentPassword: currentPassword ?? null,
  });
}

export async function localAuthClearPassword(
  userId: string,
  currentPassword: string,
): Promise<LocalAuthStatus> {
  return invokeDb("local_auth_clear_password", { userId, currentPassword });
}

export async function localAuthVerify(
  userId: string,
  password: string,
): Promise<boolean> {
  if (!isTauri()) return true;
  return invokeDb("local_auth_verify", { userId, password });
}
