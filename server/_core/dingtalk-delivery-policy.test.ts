import { describe, expect, it } from "vitest";
import { resolveDingtalkDeliveryPolicy } from "./dingtalk-delivery-policy";

describe("DingTalk delivery policy", () => {
  it.each([
    {
      name: "unit/integration test process",
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://app:secret@db.example.com:5432/cehub",
      },
      enabled: false,
      reason: "non_production",
    },
    {
      name: "local development process",
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgres://postgres:secret@127.0.0.1:55432/cehub",
      },
      enabled: false,
      reason: "non_production",
    },
    {
      name: "production bundle connected to a dated test database",
      env: {
        NODE_ENV: "production",
        DATABASE_URL:
          "postgres://app:secret@db.example.com:5432/cehub_test_20260718",
      },
      enabled: false,
      reason: "test_database",
    },
    {
      name: "production database",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:secret@db.example.com:5432/cehub",
      },
      enabled: true,
      reason: "production_default",
    },
    {
      name: "staging database whose name is not the test convention",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:secret@db.example.com:5432/cehub_staging",
      },
      enabled: true,
      reason: "production_default",
    },
    {
      name: "host and query containing test do not classify the database",
      env: {
        NODE_ENV: "production",
        DATABASE_URL:
          "postgres://test_user:secret@test-db.example.com:5432/cehub?application_name=test",
      },
      enabled: true,
      reason: "production_default",
    },
    {
      name: "malformed production URL preserves the production default",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "not-a-postgres-url",
      },
      enabled: true,
      reason: "production_default",
    },
    {
      name: "explicit disabled mode wins in production",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:secret@db.example.com:5432/cehub",
        DINGTALK_DELIVERY_MODE: "disabled",
      },
      enabled: false,
      reason: "explicit_disabled",
    },
    {
      name: "test database classification wins over explicit disabled mode",
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:secret@db.example.com:5432/cehub_test",
        DINGTALK_DELIVERY_MODE: "disabled",
      },
      enabled: false,
      reason: "test_database",
    },
    {
      name: "non-production classification wins over explicit disabled mode",
      env: {
        NODE_ENV: "test",
        DATABASE_URL:
          "postgres://app:secret@db.example.com:5432/cehub_transport_fixture",
        DINGTALK_DELIVERY_MODE: "disabled",
      },
      enabled: false,
      reason: "non_production",
    },
    {
      name: "test database remains silent even with explicit live mode",
      env: {
        NODE_ENV: "production",
        DATABASE_URL:
          "postgres://app:secret@db.example.com:5432/cehub_test_20260718",
        DINGTALK_DELIVERY_MODE: "live",
      },
      enabled: false,
      reason: "test_database",
    },
    {
      name: "explicit live mode allows controlled delivery on a non-test database",
      env: {
        NODE_ENV: "test",
        DATABASE_URL:
          "postgres://app:secret@db.example.com:5432/cehub_transport_fixture",
        DINGTALK_DELIVERY_MODE: "live",
      },
      enabled: true,
      reason: "explicit_live",
    },
  ])("resolves $name", ({ env, enabled, reason }) => {
    expect(resolveDingtalkDeliveryPolicy(env)).toEqual({ enabled, reason });
  });
});
