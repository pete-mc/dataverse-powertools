/* eslint-disable camelcase */
import { makeObservable, observable, action } from 'mobx'
import { ControlContextService, ServiceProvider } from 'pcf-react'
import { CdsService } from './CdsService'
export class DATASETITEM {
  key: string | number;
  id: string;
  title: string | null = null;
  TEXTPARAMETER: string | null = null;
  TEXTPARAMETER_Formatted: string | null = null;
  serviceProvider: ServiceProvider;
  controlContext: ControlContextService;
  record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

  constructor (record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord, serviceProvider: ServiceProvider) {
    makeObservable(this, {
      title: observable,
      onChangeTitle: action.bound
    })
    this.serviceProvider = serviceProvider
    this.record = record
    this.key = record.getRecordId()
    this.id = record.getRecordId()
    this.title = record.getValue('TEXTPARAMETERSET') as string
    this.TEXTPARAMETER = record.getValue('TEXTPARAMETERSET') as string
    this.TEXTPARAMETER_Formatted = record.getFormattedValue('TEXTPARAMETERSET') as string
  }

  async onChangeTitle (newValue: string | null): Promise<void> {
    try {
      this.title = newValue
      await this.serviceProvider.get<CdsService>(CdsService.serviceProviderName).updateItem(this)
    } catch (ex) {
      this.serviceProvider.get<ControlContextService>(ControlContextService.serviceProviderName).showErrorDialog(ex as Error)
    }
  }
}
