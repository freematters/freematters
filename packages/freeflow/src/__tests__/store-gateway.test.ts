import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Store } from "../store.js";
import { cleanupTempDir, createTempDir, freshStore } from "./fixtures.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("store-gateway");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

describe("Store — gateway fields on RunMeta", () => {
  test("initRun with gateway fields stores them in meta", () => {
    const store = freshStore(tmp);
    const meta = store.initRun("gw-run-1", "/fake/path.yaml", false, {
      gateway_id: "gw-123",
      client_id: "cli-456",
      daemon_id: "dmn-789",
    });

    expect(meta.gateway_id).toBe("gw-123");
    expect(meta.client_id).toBe("cli-456");
    expect(meta.daemon_id).toBe("dmn-789");

    // Read back from disk
    const readBack = store.readMeta("gw-run-1");
    expect(readBack.gateway_id).toBe("gw-123");
    expect(readBack.client_id).toBe("cli-456");
    expect(readBack.daemon_id).toBe("dmn-789");
  });

  test("initRun without gateway fields works as before", () => {
    const store = freshStore(tmp);
    const meta = store.initRun("gw-run-2", "/fake/path.yaml");

    expect(meta.gateway_id).toBeUndefined();
    expect(meta.client_id).toBeUndefined();
    expect(meta.daemon_id).toBeUndefined();
  });

  test("initRun with partial gateway fields", () => {
    const store = freshStore(tmp);
    const meta = store.initRun("gw-run-3", "/fake/path.yaml", false, {
      gateway_id: "gw-only",
    });

    expect(meta.gateway_id).toBe("gw-only");
    expect(meta.client_id).toBeUndefined();
    expect(meta.daemon_id).toBeUndefined();
  });
});

describe("Store — updateGatewayInfo", () => {
  test("updates gateway fields on an existing run", () => {
    const store = freshStore(tmp);
    store.initRun("gw-upd-1", "/fake/path.yaml");

    store.updateGatewayInfo("gw-upd-1", {
      gateway_id: "gw-new",
      client_id: "cli-new",
      daemon_id: "dmn-new",
    });

    const meta = store.readMeta("gw-upd-1");
    expect(meta.gateway_id).toBe("gw-new");
    expect(meta.client_id).toBe("cli-new");
    expect(meta.daemon_id).toBe("dmn-new");
  });

  test("partial update preserves existing gateway fields", () => {
    const store = freshStore(tmp);
    store.initRun("gw-upd-2", "/fake/path.yaml", false, {
      gateway_id: "gw-orig",
      client_id: "cli-orig",
    });

    store.updateGatewayInfo("gw-upd-2", {
      daemon_id: "dmn-added",
    });

    const meta = store.readMeta("gw-upd-2");
    expect(meta.gateway_id).toBe("gw-orig");
    expect(meta.client_id).toBe("cli-orig");
    expect(meta.daemon_id).toBe("dmn-added");
  });

  test("overwrite existing gateway fields", () => {
    const store = freshStore(tmp);
    store.initRun("gw-upd-3", "/fake/path.yaml", false, {
      gateway_id: "gw-old",
    });

    store.updateGatewayInfo("gw-upd-3", {
      gateway_id: "gw-replaced",
    });

    const meta = store.readMeta("gw-upd-3");
    expect(meta.gateway_id).toBe("gw-replaced");
  });
});
