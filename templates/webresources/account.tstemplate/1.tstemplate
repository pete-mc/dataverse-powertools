export class Account {
  static async OnLoad(executionContext: Xrm.ExecutionContext<unknown, unknown>): Promise<void> {
    const form = <Form.account.Main.Account>executionContext.getFormContext();
    console.log(form.ui.setFormNotification("loaded", "INFO", "demoid"));
  }
}
