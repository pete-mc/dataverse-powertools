import { Account } from "../account";
import { XrmMockGenerator } from "xrm-mock";

XrmMockGenerator.initialise();
XrmMockGenerator.Attribute.createString("name", "bob");
const form = XrmMockGenerator.eventContext.getFormContext() as Form.account.Main.Account;
Account.OnLoad(XrmMockGenerator.eventContext);

it("should be bob", () => {
  expect(form.getAttribute("name").getValue()).toBe("bob");
});

