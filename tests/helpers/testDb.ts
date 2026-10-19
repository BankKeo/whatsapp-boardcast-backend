/** Shared test database lifecycle for integration tests. */

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import type { Express } from "express";
import { hashPassword } from "../../src/common/utils/password";
import { UserModel } from "../../src/modules/users/user.model";
import type { UserRole } from "../../src/common/constants/domain";

let mongo: MongoMemoryServer | null = null;

export async function startTestDb(): Promise<void> {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "partner_club_test" });
}

export async function stopTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
  await mongo?.stop();
  mongo = null;
}

export async function resetTestDb(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export const TEST_PASSWORD = "Test-Password-123";

export async function createActiveUser(
  options: { email: string; role: UserRole; name?: string; password?: string },
) {
  const password = options.password ?? TEST_PASSWORD;
  return UserModel.create({
    name: options.name ?? options.email.split("@")[0],
    email: options.email,
    role: options.role,
    status: "Active",
    passwordHash: await hashPassword(password),
  });
}

export async function login(app: Express, email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await request(app).post("/api/v1/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body.data.accessToken as string;
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
