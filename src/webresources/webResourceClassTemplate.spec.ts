import { describe, it, expect } from "vitest";
import { buildWebResourceClassPlaceholders, sanitizeFormTypeName } from "./webResourceClassTemplate";

describe("sanitizeFormTypeName", () => {
  it("keeps a form name that is already a valid identifier", () => {
    expect(sanitizeFormTypeName("Information")).toBe("Information");
  });

  it("strips spaces and punctuation so the type reference compiles", () => {
    expect(sanitizeFormTypeName("Account - Main Form")).toBe("AccountMainForm");
  });

  it("prefixes an underscore when the name would start with a digit", () => {
    expect(sanitizeFormTypeName("360 View")).toBe("_360View");
  });

  it("falls back to 'Information' for an empty or all-symbol name", () => {
    expect(sanitizeFormTypeName("")).toBe("Information");
    expect(sanitizeFormTypeName("***")).toBe("Information");
  });
});

describe("buildWebResourceClassPlaceholders", () => {
  const placeholders = buildWebResourceClassPlaceholders({
    className: "AccountForm",
    entity: "account",
    formName: "Account Information",
    formId: "11111111-1111-1111-1111-111111111111",
    libraryPrefix: "sq",
    triggerId: "22222222-2222-2222-2222-222222222222",
    notificationId: "33333333-3333-3333-3333-333333333333",
  });
  const byToken = Object.fromEntries(placeholders.map((p) => [p.placeholder, p.value]));

  it("maps the library prefix so the handler reference resolves at runtime", () => {
    expect(byToken.SOLUTIONPREFIX).toBe("sq");
  });

  it("uses the sanitized form name for the type reference", () => {
    expect(byToken.FormName).toBe("AccountInformation");
  });

  it("passes through the picked table, form id and class name", () => {
    expect(byToken.TableName).toBe("account");
    expect(byToken.ClassName).toBe("AccountForm");
    expect(byToken.FORMIDPLACEHOLDER).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("gives the trigger and notification distinct unique ids", () => {
    expect(byToken.NEWGUID).toBe("22222222-2222-2222-2222-222222222222");
    expect(byToken.NOTIFICATIONID).toBe("33333333-3333-3333-3333-333333333333");
    expect(byToken.NEWGUID).not.toBe(byToken.NOTIFICATIONID);
  });
});
