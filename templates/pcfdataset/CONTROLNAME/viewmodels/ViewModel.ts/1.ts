import { ControlContextService, DatasetChangedEventArgs, ParametersChangedEventArgs, ServiceProvider } from 'pcf-react'
import { makeObservable, IObservableArray, observable, action, computed } from 'mobx'
import { DATASETITEM } from './DATASETITEM'
import { IInputs } from '../generated/ManifestTypes'
export class ViewModel {
  static serviceProviderName = 'ViewModel';
  serviceProvider: ServiceProvider;
  controlContext: ControlContextService;
  isBusy = true;
  pageNumber = 1;
  pageSize = 25;
  totalRecords: number | undefined = 25;
  data: DATASETITEM[] = [];
  selection: DATASETITEM[] = [];
  TEXTPARAMETER: string | null;
  firstRun = true;
  columns: ComponentFramework.PropertyHelper.DataSetApi.Column[] = [];
  pcfContext: ComponentFramework.Context<IInputs>;

  constructor (serviceProvider: ServiceProvider) {
    makeObservable(this, {
      isBusy: observable,
      columns: observable,
      data: observable,
      pageNumber: observable,
      pageSize: observable,
      totalRecords: observable,
      DATASETITEMS: computed,
      datagridColumns: computed,
      selection: observable,
      onDataChanged: action.bound,
      onSelectionChanged: action.bound,
      onSort: action.bound,
      onPageFirst: action.bound,
      onPageBack: action.bound,
      onPageNext: action.bound,
      onOpenItem: action.bound
    })
    this.serviceProvider = serviceProvider
    this.controlContext = this.serviceProvider.get(ControlContextService.serviceProviderName)
    this.controlContext.onDataChangedEvent.subscribe(this.onDataChanged)
    // this.controlContext.onLoadEvent.subscribe(this.onLoad);
    // this.controlContext.onParametersChangedEvent.subscribe(this.onInParametersChanged);
  }

  get DATASETITEMS (): DATASETITEM[] {
    return this.data.map((a) => a)
  }

  get datagridColumns (): {
    key: string;
    name: string;
    fieldName: string;
    minWidth: number;
    isResizable: boolean;
    maxWidth: number;
  }[] {
    const sorting = this.controlContext.getSort()
    return this.columns
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => {
        const sort = sorting.find((s) => s.name == c.name)
        return {
          key: c.alias,
          name: c.displayName,
          fieldName: c.name,
          minWidth: 50,
          isResizable: true,
          isSorted: sort != null,
          isSortedDescending: sort?.sortDirection == 1,
          maxWidth: c.visualSizeFactor
        }
      })
  }

  onSort (sortBy: string, isSortedDescending: boolean): void {
    this.isBusy = this.controlContext.applySort(
      [
        {
          name: sortBy,
          sortDirection: isSortedDescending ? 1 : 0
        }
      ],
      true
    )
  }

  onSelectionChanged (selection: DATASETITEM[]): void {
    this.selection = selection
    const selectionids = selection.map((i) => i.id)
    console.log('Selection ids v3:' + JSON.stringify(selectionids))
    this.pcfContext.parameters.dataset.setSelectedRecordIds(selectionids)
  }

  onDataChanged (service: ControlContextService, onDataChanged: DatasetChangedEventArgs): void {
    // if (this.firstRun) {
    //   // stuff for first run
    //   this.firstRun = false;
    // }
    this.isBusy = false
    const rows = onDataChanged.data.map((r) => new DATASETITEM(r, this.serviceProvider))
    const datasetColumns = this.controlContext.getColumns()
    this.pageNumber = onDataChanged.page
    this.pageSize = onDataChanged.pageSize
    this.totalRecords = onDataChanged.totalRecords
    this.columns = datasetColumns;
    (this.data as IObservableArray).replace(rows)
  }

  onLoad (): void {
    // onLoad
  }

  onPageFirst (): void {
    this.isBusy = true
    this.controlContext.setPage(1)
  }

  onPageBack (): void {
    this.isBusy = true
    this.controlContext.previousPage()
  }

  onPageNext (): void {
    this.isBusy = true
    this.controlContext.nextPage()
  }

  onInParametersChanged (context: ControlContextService, args: ParametersChangedEventArgs): void {
    for (const param of args.updated) {
      switch (param) {
        case 'TEXTPARAMETER':
          this.TEXTPARAMETER = args.values[param] as string | null
          break
      }
    }
  }

  openRecord (logicalName: string, id: string, onSuccess?: () => void): void {
    const globalContext = Xrm.Utility.getGlobalContext()
    const version = globalContext.getVersion().split('.')
    const mobile = globalContext.client.getClient() == 'Mobile'
    if (
      !mobile &&
      version.length == 4 &&
      Number.parseFloat(version[0] + '.' + version[1]) >= 9.1 &&
      Number.parseFloat(version[2] + '.' + version[3]) >= 0.15631
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Xrm.Navigation as any)
        .navigateTo(
          {
            entityName: logicalName,
            pageType: 'entityrecord',
            formType: 2,
            entityId: id
          },
          { target: 2, position: 1, width: { value: 80, unit: '%' } }
        )
        .then(() => {
          if (onSuccess) onSuccess()
        })
    } else {
      Xrm.Navigation.openForm({
        entityName: logicalName,
        entityId: id
      })
    }
  }

  onOpenItem (item: DATASETITEM): void {
    if (item != undefined) {
      const reference = item.record.getNamedReference()
      // Allowing "any" to use .logicalName due to known bug
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.openRecord((reference as any).logicalName as string, (reference.id as unknown) as string, () =>
        this.controlContext.refreshDataset()
      )
    }
  }
}
