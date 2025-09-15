// tests/item-issuer.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 1000;
const ERR_INVALID_METADATA = 1001;
const ERR_INVALID_ITEM_TYPE = 1002;
const ERR_INVALID_EXPIRY = 1003;
const ERR_INVALID_ISSUER_FEE = 1004;
const ERR_ITEM_ALREADY_EXISTS = 1005;
const ERR_MAX_ITEMS_EXCEEDED = 1006;
const ERR_AUTHORITY_NOT_SET = 1007;
const ERR_INVALID_LOCATION = 1008;
const ERR_INVALID_CATEGORY = 1009;
const ERR_INVALID_SERIAL = 1010;
const ERR_EXPIRY_PAST = 1011;
const ERR_UPDATE_NOT_ALLOWED = 1012;
const ERR_INVALID_UPDATE = 1013;

interface Item {
  metadata: string;
  itemType: string;
  expiry: number;
  serial: string;
  location: string;
  category: string;
  issuedAt: number;
  issuer: string;
  status: boolean;
}

interface ItemUpdate {
  updateMetadata: string;
  updateExpiry: number;
  updateLocation: string;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ItemIssuerMock {
  state: {
    nextItemId: number;
    maxItems: number;
    issuerFee: number;
    authorityContract: string | null;
    defaultLocation: string;
    items: Map<number, Item>;
    itemUpdates: Map<number, ItemUpdate>;
    itemsBySerial: Map<string, number>;
    itemsByType: Map<string, number[]>;
  } = {
    nextItemId: 0,
    maxItems: 5000,
    issuerFee: 500,
    authorityContract: null,
    defaultLocation: "Global",
    items: new Map(),
    itemUpdates: new Map(),
    itemsBySerial: new Map(),
    itemsByType: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextItemId: 0,
      maxItems: 5000,
      issuerFee: 500,
      authorityContract: null,
      defaultLocation: "Global",
      items: new Map(),
      itemUpdates: new Map(),
      itemsBySerial: new Map(),
      itemsByType: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setIssuerFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newFee < 0) return { ok: false, value: false };
    this.state.issuerFee = newFee;
    return { ok: true, value: true };
  }

  setMaxItems(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: false };
    this.state.maxItems = newMax;
    return { ok: true, value: true };
  }

  setDefaultLocation(newLoc: string): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newLoc.length > 50 || (newLoc !== "Global" && (newLoc.length === 0 || newLoc.length > 50))) {
      return { ok: false, value: false };
    }
    this.state.defaultLocation = newLoc;
    return { ok: true, value: true };
  }

  mintItem(
    metadataStr: string,
    itemType: string,
    expiry: number,
    serial: string,
    location: string,
    category: string
  ): Result<number> {
    if (this.state.nextItemId >= this.state.maxItems) return { ok: false, value: ERR_MAX_ITEMS_EXCEEDED };
    if (metadataStr.length === 0 || metadataStr.length > 100) return { ok: false, value: ERR_INVALID_METADATA };
    if (!["passport", "visa", "aid-kit", "document"].includes(itemType)) return { ok: false, value: ERR_INVALID_ITEM_TYPE };
    if (expiry < this.blockHeight) return { ok: false, value: ERR_EXPIRY_PAST };
    if (serial.length === 0 || serial.length > 50) return { ok: false, value: ERR_INVALID_SERIAL };
    if (location !== "Global" && (location.length === 0 || location.length > 50)) return { ok: false, value: ERR_INVALID_LOCATION };
    if (category.length === 0 || category.length > 30) return { ok: false, value: ERR_INVALID_CATEGORY };
    if (this.state.itemsBySerial.has(serial)) return { ok: false, value: ERR_ITEM_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };

    this.stxTransfers.push({ amount: this.state.issuerFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextItemId;
    const item: Item = {
      metadata: metadataStr,
      itemType,
      expiry,
      serial,
      location: location === "" ? this.state.defaultLocation : location,
      category,
      issuedAt: this.blockHeight,
      issuer: this.caller,
      status: true,
    };
    this.state.items.set(id, item);
    this.state.itemsBySerial.set(serial, id);
    let existingTypes = this.state.itemsByType.get(itemType) || [];
    if (existingTypes.length >= 100) {
      existingTypes = existingTypes.slice(-99);
    }
    existingTypes.push(id);
    this.state.itemsByType.set(itemType, existingTypes);
    this.state.nextItemId++;
    return { ok: true, value: id };
  }

  getItem(id: number): Item | null {
    return this.state.items.get(id) || null;
  }

  updateItem(id: number, updateMetadata: string, updateExpiry: number, updateLocation: string): Result<boolean> {
    const currentItem = this.state.items.get(id);
    if (!currentItem) return { ok: false, value: false };
    if (currentItem.issuer !== this.caller) return { ok: false, value: false };
    if (!currentItem.status) return { ok: false, value: false };
    if (updateMetadata.length === 0 || updateMetadata.length > 100) return { ok: false, value: false };
    if (updateExpiry < this.blockHeight) return { ok: false, value: false };
    if (updateLocation !== "Global" && (updateLocation.length === 0 || updateLocation.length > 50)) return { ok: false, value: false };

    const updated: Item = {
      ...currentItem,
      metadata: updateMetadata,
      expiry: updateExpiry,
      location: updateLocation,
    };
    this.state.items.set(id, updated);
    this.state.itemUpdates.set(id, {
      updateMetadata,
      updateExpiry,
      updateLocation,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  deactivateItem(id: number): Result<boolean> {
    const currentItem = this.state.items.get(id);
    if (!currentItem) return { ok: false, value: false };
    if (currentItem.issuer !== this.caller) return { ok: false, value: false };

    const deactivated: Item = {
      ...currentItem,
      status: false,
    };
    this.state.items.set(id, deactivated);
    return { ok: true, value: true };
  }

  getItemCount(): Result<number> {
    return { ok: true, value: this.state.nextItemId };
  }
}

describe("ItemIssuer", () => {
  let contract: ItemIssuerMock;

  beforeEach(() => {
    contract = new ItemIssuerMock();
    contract.reset();
  });

  it("mints an item successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.mintItem(
      "Passport metadata",
      "passport",
      100,
      "SERIAL123",
      "BorderPost",
      "TravelDoc"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const item = contract.getItem(0);
    expect(item?.metadata).toBe("Passport metadata");
    expect(item?.itemType).toBe("passport");
    expect(item?.expiry).toBe(100);
    expect(item?.serial).toBe("SERIAL123");
    expect(item?.location).toBe("BorderPost");
    expect(item?.category).toBe("TravelDoc");
    expect(item?.status).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects without authority contract", () => {
    const result = contract.mintItem(
      "NoAuth",
      "aid-kit",
      150,
      "NOAUTH1",
      "Global",
      "Aid"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_SET);
  });

  it("rejects invalid metadata length", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.mintItem(
      "A".repeat(101),
      "passport",
      100,
      "LONG1",
      "Loc",
      "Cat"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_METADATA);
  });

  it("rejects invalid item type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.mintItem(
      "InvalidType",
      "invalid",
      100,
      "INV1",
      "Loc",
      "Cat"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ITEM_TYPE);
  });

  it("rejects past expiry", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.blockHeight = 200;
    const result = contract.mintItem(
      "PastExp",
      "visa",
      100,
      "PAST1",
      "Loc",
      "Cat"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_EXPIRY_PAST);
  });

  it("updates an item successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.mintItem(
      "OldMeta",
      "document",
      300,
      "UPD1",
      "OldLoc",
      "OldCat"
    );
    const result = contract.updateItem(0, "NewMeta", 400, "NewLoc");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const item = contract.getItem(0);
    expect(item?.metadata).toBe("NewMeta");
    expect(item?.expiry).toBe(400);
    expect(item?.location).toBe("NewLoc");
    const update = contract.state.itemUpdates.get(0);
    expect(update?.updateMetadata).toBe("NewMeta");
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent item", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateItem(99, "NewMeta", 400, "NewLoc");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-issuer", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.mintItem(
      "Test",
      "passport",
      100,
      "TEST1",
      "Loc",
      "Cat"
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateItem(0, "NewMeta", 400, "NewLoc");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("deactivates an item successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.mintItem(
      "Active",
      "aid-kit",
      150,
      "DEACT1",
      "Loc",
      "Cat"
    );
    const result = contract.deactivateItem(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const item = contract.getItem(0);
    expect(item?.status).toBe(false);
  });

  it("sets issuer fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setIssuerFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.issuerFee).toBe(1000);
    contract.mintItem(
      "FeeTest",
      "visa",
      200,
      "FEE1",
      "Loc",
      "Cat"
    );
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("returns correct item count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.mintItem(
      "One",
      "passport",
      100,
      "ONE1",
      "Loc",
      "Cat"
    );
    contract.mintItem(
      "Two",
      "document",
      200,
      "TWO1",
      "Loc",
      "Cat"
    );
    const result = contract.getItemCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("parses parameters with Clarity types", () => {
    const metadata = stringAsciiCV("TestMeta");
    const expiry = uintCV(150);
    expect(metadata.value).toBe("TestMeta");
    expect(expiry.value).toEqual(BigInt(150));
  });

  it("rejects max items exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxItems = 1;
    contract.mintItem(
      "First",
      "visa",
      100,
      "MAX1",
      "Loc",
      "Cat"
    );
    const result = contract.mintItem(
      "Second",
      "document",
      200,
      "MAX2",
      "Loc",
      "Cat"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_ITEMS_EXCEEDED);
  });
});