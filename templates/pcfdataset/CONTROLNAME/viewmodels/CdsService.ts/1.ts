import { DATASETITEM } from './DATASETITEM'

export class CdsService {
  static serviceProviderName = 'CdsService';
  context: ComponentFramework.Context<unknown>;
  config: { todoEntityType: string; textField: string };
  constructor (context: ComponentFramework.Context<unknown>, config: { todoEntityType: string; textField: string }) {
    this.context = context
    this.config = config
  }

  async updateItem (item: DATASETITEM): Promise<void> {
    const update: Record<string, string | Date | undefined | null> = {}

    // let completedDate: Date | null = null;

    // if (item.dateField) {
    //   const localOffset = item.dateField.getTimezoneOffset();
    //   const offset = this.context.userSettings.getTimeZoneOffsetMinutes(item.dateField);
    //   completedDate = new Date(item.dateField.getTime() - (offset + localOffset) * 60000);
    // }

    // update[this.config.dateField] = completedDate;
    update[this.config.textField] = item.title
    await this.context.webAPI.updateRecord(this.config.todoEntityType, item.id, update)
  }
}
